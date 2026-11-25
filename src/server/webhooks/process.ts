import { and, eq, gt, lt, or, sql } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'

import { db } from '#/db/client'
import {
  auditLog,
  domain,
  mailbox,
  message,
  providerConfig,
  webhookEndpoint,
  webhookEvent,
} from '#/db/schema'
import { invalidatePublicLoginConfig } from '#/server/auth/public-providers'
import { decryptSecret } from '#/server/crypto/secret-box'
import { AppError, logError } from '#/server/errors'
import { ingestInbound } from '#/server/mail/ingest'
import { getProvider } from '#/server/providers'
import type {
  MessageStatus,
  ProviderRuntimeConfig,
  VerifiedWebhookEvent,
} from '#/server/providers'

const idPart = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 20)

/**
 * 处理中的事件停在 received 超过这个时长，视为上次处理中途崩溃（进程重启、超时），
 * 允许服务商重投时重新抢占；入库本身按 providerMessageId 幂等，重跑是安全的。
 */
const STALE_RECEIVED_MS = 5 * 60 * 1000
/** 投诉自动停用阈值(近 7 天) */
const COMPLAINT_DISABLE_THRESHOLD = 5
const COMPLAINT_WINDOW_MS = 7 * 24 * 3600 * 1000

/** 投递状态只允许单向推进，避免乱序到达的 delivery_delayed 把 delivered 改回 sent */
const STATUS_RANK: Record<string, number> = {
  sent: 1,
  delivered: 2,
  bounced: 3,
  complained: 3,
  failed: 3,
  suppressed: 3,
}

export interface ProcessWebhookInput {
  providerKind: string
  endpointId: string
  rawBody: string
  headers: Record<string, string>
}

type EndpointRow = typeof webhookEndpoint.$inferSelect
type ConfigRow = typeof providerConfig.$inferSelect

/**
 * 抢占事件的处理权。
 * 新事件直接插入；已存在的行只有上次处理失败、或停在 received 超过
 * STALE_RECEIVED_MS（上次处理中途崩溃）时才允许服务商重投重跑（`attempts` 递增），
 * processed / ignored 与仍在处理中的 received 一律按重复丢弃，避免重复入库。
 */
async function claimEvent(params: {
  event: VerifiedWebhookEvent
  endpoint: EndpointRow
  config: ConfigRow
}): Promise<string | null> {
  const { event, endpoint, config } = params
  const payloadJson = JSON.stringify(event).slice(0, 50_000)

  const inserted = await db
    .insert(webhookEvent)
    .values({
      id: idPart(),
      endpointId: endpoint.id,
      providerConfigId: config.id,
      providerEventId: event.eventId,
      type: event.type,
      payloadJson,
      status: 'received',
      receivedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: webhookEvent.id })

  if (inserted.length > 0) return inserted[0].id

  const existingRows = await db
    .select({
      id: webhookEvent.id,
      status: webhookEvent.status,
      receivedAt: webhookEvent.receivedAt,
    })
    .from(webhookEvent)
    .where(
      and(
        eq(webhookEvent.endpointId, endpoint.id),
        eq(webhookEvent.providerEventId, event.eventId),
      ),
    )
    .limit(1)
  const existing = existingRows[0] as
    | Pick<typeof webhookEvent.$inferSelect, 'id' | 'status' | 'receivedAt'>
    | undefined
  if (!existing) return null

  const staleCutoff = new Date(Date.now() - STALE_RECEIVED_MS)
  const reclaimable =
    existing.status === 'failed' ||
    (existing.status === 'received' &&
      existing.receivedAt.getTime() < staleCutoff.getTime())
  if (!reclaimable) return null

  // 条件更新：两次重投并发到达时只有一个能抢到
  const reclaimed = await db
    .update(webhookEvent)
    .set({
      status: 'received',
      type: event.type,
      payloadJson,
      error: null,
      processedAt: null,
      // 刷新时间戳，作为本次处理的「心跳」，供下一次判断是否卡死
      receivedAt: new Date(),
      attempts: sql`${webhookEvent.attempts} + 1`,
    })
    .where(
      and(
        eq(webhookEvent.id, existing.id),
        or(
          eq(webhookEvent.status, 'failed'),
          and(
            eq(webhookEvent.status, 'received'),
            lt(webhookEvent.receivedAt, staleCutoff),
          ),
        ),
      ),
    )
    .returning({ id: webhookEvent.id })

  return reclaimed[0]?.id ?? null
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function outboundMessageExists(
  providerConfigId: string,
  providerMessageId: string,
): Promise<boolean> {
  return Boolean(
    (
      await db
        .select({ id: message.id })
        .from(message)
        .where(
          and(
            eq(message.providerConfigId, providerConfigId),
            eq(message.providerMessageId, providerMessageId),
            eq(message.direction, 'outbound'),
          ),
        )
        .limit(1)
    ).at(0),
  )
}

/** 状态事件可能比 sendMail 的本地落库更早到达,短暂等待后再判丢。 */
async function applyOutboundStatus(params: {
  providerConfigId: string
  providerMessageId: string
  status: MessageStatus
  rank: number
}): Promise<'updated' | 'exists' | 'missing'> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rows = await db
      .update(message)
      .set({ status: params.status })
      .where(
        and(
          eq(message.providerConfigId, params.providerConfigId),
          eq(message.providerMessageId, params.providerMessageId),
          eq(message.direction, 'outbound'),
          sql`(case ${message.status}
            when 'delivered' then 2
            when 'bounced' then 3
            when 'complained' then 3
            when 'failed' then 3
            when 'suppressed' then 3
            else 1 end) <= ${params.rank}`,
        ),
      )
      .returning({ id: message.id })
    if (rows.length > 0) return 'updated'
    if (
      await outboundMessageExists(
        params.providerConfigId,
        params.providerMessageId,
      )
    ) {
      return 'exists'
    }
    if (attempt < 4) await sleep(100)
  }
  return 'missing'
}

/**
 * 投诉阈值处置:只统计近 7 天同一域名下的 complained 状态。
 * 达到阈值后关闭该域名的发送开关并写审计,避免继续用被投诉的域名发信。
 */
async function handleComplaint(params: {
  providerConfigId: string
  providerMessageId: string
}) {
  const row = (
    await db
      .select({ mailboxId: message.mailboxId })
      .from(message)
      .where(
        and(
          eq(message.providerConfigId, params.providerConfigId),
          eq(message.providerMessageId, params.providerMessageId),
          eq(message.direction, 'outbound'),
        ),
      )
      .limit(1)
  ).at(0)
  if (!row) return

  const domainRow = (
    await db
      .select({ id: domain.id, hostname: domain.hostname })
      .from(mailbox)
      .innerJoin(domain, eq(domain.id, mailbox.domainId))
      .where(eq(mailbox.id, row.mailboxId))
      .limit(1)
  ).at(0)
  if (!domainRow) return

  const cutoff = new Date(Date.now() - COMPLAINT_WINDOW_MS)
  const countRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(message)
    .innerJoin(mailbox, eq(mailbox.id, message.mailboxId))
    .where(
      and(
        eq(mailbox.domainId, domainRow.id),
        eq(message.status, 'complained'),
        gt(message.receivedAt, cutoff),
      ),
    )
  const count = Number(countRows[0]?.count ?? 0)
  if (count < COMPLAINT_DISABLE_THRESHOLD) return

  const disabled = await db
    .update(domain)
    .set({ sendingEnabled: false, updatedAt: new Date() })
    .where(and(eq(domain.id, domainRow.id), eq(domain.sendingEnabled, true)))
    .returning({ id: domain.id })
  if (disabled.length === 0) return

  invalidatePublicLoginConfig()

  await db.insert(auditLog).values({
    id: idPart(),
    actorRole: 'system',
    action: 'domain.complaint_disable',
    targetType: 'domain',
    targetId: domainRow.hostname,
    metaJson: JSON.stringify({
      reason: 'complaints',
      count,
      windowDays: 7,
    }),
    createdAt: new Date(),
  })
}

/** 单个事件的处理：先抢占去重行，再落库；失败标记 failed 并抛出，让服务商重投 */
async function handleEvent(params: {
  event: VerifiedWebhookEvent
  endpoint: EndpointRow
  config: ConfigRow
  runtime: ProviderRuntimeConfig
  provider: ReturnType<typeof getProvider>
}) {
  const { event, endpoint, config, runtime, provider } = params

  const claimedId = await claimEvent({ event, endpoint, config })
  if (!claimedId) return { duplicate: true }

  // 显式再绑一次：闭包里用不到上一层的收窄结果
  const eventRowId = claimedId

  async function markProcessed() {
    await db.batch([
      db
        .update(webhookEvent)
        .set({ status: 'processed', processedAt: new Date() })
        .where(eq(webhookEvent.id, eventRowId)),
      db
        .update(webhookEndpoint)
        .set({
          lastEventAt: new Date(),
          eventCount: sql`${webhookEndpoint.eventCount} + 1`,
        })
        .where(eq(webhookEndpoint.id, endpoint.id)),
    ])
  }

  try {
    if (event.kind === 'inbound') {
      const outcome = await ingestInbound({
        providerConfigId: config.id,
        provider,
        runtime,
        data: event.data,
      })
      await markProcessed()
      return { outcome }
    }

    if (event.kind === 'status') {
      const rank = STATUS_RANK[event.data.status] ?? 1
      const outcome = await applyOutboundStatus({
        providerConfigId: config.id,
        providerMessageId: event.data.providerMessageId,
        status: event.data.status,
        rank,
      })
      if (outcome === 'missing') {
        // 多半是团队级 Webhook 里其它应用的事件,或者本地消息还没落库。
        // 已做过短暂重试,再返回 5xx 会让服务商持续重投;标记 ignored 并留痕。
        logError(
          '[webhook] status event has no local message:',
          new Error(event.data.providerMessageId),
        )
        await db
          .update(webhookEvent)
          .set({ status: 'ignored', error: 'message_not_found' })
          .where(eq(webhookEvent.id, eventRowId))
        return { status: 'ignored' }
      }
      if (event.data.status === 'complained') {
        try {
          await handleComplaint({
            providerConfigId: config.id,
            providerMessageId: event.data.providerMessageId,
          })
        } catch (error) {
          logError('[webhook] complaint handling failed:', error)
        }
      }
      await markProcessed()
      return { status: outcome }
    }

    await db
      .update(webhookEvent)
      .set({ status: 'ignored', processedAt: new Date() })
      .where(eq(webhookEvent.id, eventRowId))
    return { ignored: true }
  } catch (error) {
    await db
      .update(webhookEvent)
      .set({
        status: 'failed',
        error: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
        processedAt: new Date(),
      })
      .where(eq(webhookEvent.id, eventRowId))
    throw error
  }
}

export async function processWebhook(input: ProcessWebhookInput) {
  const row = (
    await db
      .select({
        endpoint: webhookEndpoint,
        config: providerConfig,
      })
      .from(webhookEndpoint)
      .innerJoin(
        providerConfig,
        eq(providerConfig.id, webhookEndpoint.providerConfigId),
      )
      .where(eq(webhookEndpoint.id, input.endpointId))
      .limit(1)
  )[0] as
    | {
        endpoint: typeof webhookEndpoint.$inferSelect
        config: typeof providerConfig.$inferSelect
      }
    | undefined

  if (!row || !row.endpoint.enabled) {
    throw new AppError('not_found', 'Webhook 端点不存在', 404)
  }

  const { endpoint, config } = row

  // URL 里的 kind 必须与端点所属服务商一致，避免把 A 家的推送配成 B 家的地址
  if (input.providerKind && input.providerKind !== config.kind) {
    throw new AppError(
      'validation_failed',
      'Webhook URL 与服务商类型不一致',
      400,
    )
  }

  const provider = getProvider(config.kind)
  const runtime: ProviderRuntimeConfig = {
    apiKey: decryptSecret(config.apiKeyEnc),
    apiBaseUrl: config.apiBaseUrl,
    accountId: config.externalAccountId,
    webhookSecret: decryptSecret(endpoint.signingSecretEnc),
  }

  // 验签失败直接 401，不写事件表
  const verified = provider.verifyWebhook(input.rawBody, input.headers, runtime)
  const events = Array.isArray(verified) ? verified : [verified]
  if (events.length === 0) return { ok: true, events: 0, results: [] }

  const results: unknown[] = []
  for (const event of events) {
    results.push(
      await handleEvent({ event, endpoint, config, runtime, provider }),
    )
  }

  return { ok: true, events: events.length, results }
}
