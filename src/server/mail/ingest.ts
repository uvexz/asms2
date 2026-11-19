import { and, eq, inArray, sql } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'

import { db } from '#/db/client'
import {
  attachment,
  dailyUsage,
  mailbox,
  message,
  messageBody,
  unroutedMessage,
} from '#/db/schema'
import type {
  InboundContent,
  InboundEventData,
  MailProvider,
  ProviderRuntimeConfig,
} from '#/server/providers'
import { getSiteSettings } from '#/server/settings'
import { notifyInboundMessage } from '#/server/telegram/notify'
import {
  parseAddress,
  parseAddressList,
  splitMailboxAddress,
} from '#/lib/email-address'

import { getReservedWords } from './address'
import { makeSnippet, sanitizeEmailHtml, sanitizedHtmlToText } from './content'
import { usageDateFor } from './quota'

const idPart = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 20)

export type IngestOutcome =
  | { status: 'stored'; messageId: string }
  | { status: 'unrouted'; reason: 'unknown' | 'expired' | 'domain_disabled' }
  | { status: 'duplicate' }

function threadKeyFor(
  subject: string | null | undefined,
  from: string,
  headers: Record<string, string>,
): string {
  const references = headers['references'] ?? headers['in-reply-to']
  if (references) return references.split(/\s+/)[0].slice(0, 120)
  const normalized = (subject ?? '')
    .replace(/^(re|fw|fwd)\s*:\s*/gi, '')
    .trim()
    .toLowerCase()
  return `${from.toLowerCase()}|${normalized}`.slice(0, 190)
}

async function recordUnrouted(params: {
  providerConfigId: string
  providerMessageId: string
  from: string
  to: string[]
  subject?: string | null
  reason: 'unknown' | 'expired' | 'domain_disabled'
  payload: unknown
}) {
  const existing = await db
    .select({ id: unroutedMessage.id })
    .from(unroutedMessage)
    .where(eq(unroutedMessage.providerMessageId, params.providerMessageId))
    .limit(1)
  if (existing.length > 0) return

  await db.insert(unroutedMessage).values({
    id: idPart(),
    providerConfigId: params.providerConfigId,
    providerMessageId: params.providerMessageId,
    fromAddress: params.from,
    toJson: JSON.stringify(params.to),
    subject: params.subject ?? null,
    reason: params.reason,
    payloadJson: JSON.stringify(params.payload).slice(0, 20_000),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  })
}

/**
 * 收件落库的核心流程。
 * 注意：邮件已被服务商在投递阶段收下，这里做不到"退信"，只能落库或留墓碑。
 */
export async function ingestInbound(params: {
  providerConfigId: string
  provider: MailProvider
  runtime: ProviderRuntimeConfig
  data: InboundEventData
}): Promise<IngestOutcome> {
  const { providerConfigId, provider, runtime } = params
  const settings = await getSiteSettings()

  // Mailtrap 的入站 Webhook 只带 inbox_id / message_id，不带收件人。
  // 缺 to 时先回查正文，用返回的 to 路由；否则整封邮件会被误判为 unrouted。
  let data = params.data
  let prefetched: InboundContent | undefined
  if (data.to.length === 0) {
    prefetched = await provider.getInbound(data.providerMessageId, runtime)
    data = {
      ...data,
      to: prefetched.to ?? [],
      from: data.from || prefetched.from || '',
      subject: data.subject ?? prefetched.subject ?? null,
      receivedAt: data.receivedAt ?? prefetched.receivedAt,
    }
  }

  const recipients = parseAddressList(data.to)
  const addresses = recipients.map((item) => item.address)
  if (addresses.length === 0) {
    return { status: 'unrouted', reason: 'unknown' }
  }

  // 保留前缀（postmaster / abuse 等）不允许普通用户注册，
  // 发往这些地址的邮件统一转投同域名的 admin@
  const reservedWords = new Set(getReservedWords(settings))
  const adminFallback = new Map<string, string>()
  for (const item of recipients) {
    const { localPart, domain } = splitMailboxAddress(item.address)
    if (domain && reservedWords.has(localPart)) {
      adminFallback.set(item.address, `admin@${domain}`)
    }
  }

  const lookupAddresses = [
    ...new Set([...addresses, ...adminFallback.values()]),
  ]
  const candidates = await db
    .select()
    .from(mailbox)
    .where(inArray(mailbox.address, lookupAddresses))

  const byAddress = new Map(candidates.map((row) => [row.address, row]))
  const target = recipients
    .map((item) => {
      const direct = byAddress.get(item.address)
      if (direct) return direct
      const fallback = adminFallback.get(item.address)
      return fallback ? byAddress.get(fallback) : undefined
    })
    .find(Boolean)

  if (!target) {
    await recordUnrouted({
      providerConfigId,
      providerMessageId: data.providerMessageId,
      from: data.from,
      to: addresses,
      subject: data.subject,
      reason: 'unknown',
      payload: data,
    })
    return { status: 'unrouted', reason: 'unknown' }
  }

  if (
    target.kind === 'temp' &&
    target.expiresAt !== null &&
    target.expiresAt.getTime() <= Date.now()
  ) {
    await recordUnrouted({
      providerConfigId,
      providerMessageId: data.providerMessageId,
      from: data.from,
      to: addresses,
      subject: data.subject,
      reason: 'expired',
      payload: data,
    })
    return { status: 'unrouted', reason: 'expired' }
  }

  // 幂等：同一服务商邮件 ID 只入库一次
  const seen = await db
    .select({ id: message.id })
    .from(message)
    .where(
      and(
        eq(message.providerConfigId, providerConfigId),
        eq(message.providerMessageId, data.providerMessageId),
      ),
    )
    .limit(1)
  if (seen.length > 0) return { status: 'duplicate' }

  // Webhook 已带正文的服务商（AhaSend 路由事件）直接用；缺收件人时已经回查过，复用结果
  const content =
    prefetched ??
    data.content ??
    (await provider.getInbound(data.providerMessageId, runtime))
  const headers = content.headers ?? {}
  const rawHtml = content.html ?? ''
  const sanitized = rawHtml ? sanitizeEmailHtml(rawHtml) : ''
  const plain =
    content.text ?? (sanitized ? sanitizedHtmlToText(sanitized) : '')
  const subject = data.subject ?? (headers['subject'] || '(无主题)')
  const from = parseAddress(data.from)
  const receivedAt = data.receivedAt ? new Date(data.receivedAt) : new Date()

  const attachmentMetas =
    content.attachments && content.attachments.length > 0
      ? content.attachments
      : (data.attachments ?? [])

  const messageId = idPart()
  const now = new Date()
  const usageDate = usageDateFor(settings.timezone, receivedAt)

  const statements = [
    db.insert(message).values({
      id: messageId,
      userId: target.userId,
      mailboxId: target.id,
      direction: 'inbound',
      folder: 'inbox',
      providerConfigId,
      providerMessageId: data.providerMessageId,
      internetMessageId: headers['message-id'] ?? null,
      threadKey: threadKeyFor(subject, from.address, headers),
      fromName: from.name ?? null,
      fromAddress: from.address,
      toJson: JSON.stringify(addresses),
      ccJson: data.cc?.length ? JSON.stringify(data.cc) : null,
      bccJson: data.bcc?.length ? JSON.stringify(data.bcc) : null,
      replyToJson: headers['reply-to']
        ? JSON.stringify([headers['reply-to']])
        : null,
      subject,
      snippet: makeSnippet(plain),
      status: 'received',
      isRead: false,
      isStarred: false,
      hasAttachments: attachmentMetas.length > 0,
      attachmentCount: attachmentMetas.length,
      size: new TextEncoder().encode(sanitized || plain).length,
      receivedAt,
      createdAt: now,
    }),
    db.insert(messageBody).values({
      messageId,
      htmlRaw: rawHtml || null,
      htmlSanitized: sanitized || null,
      textBody: plain || null,
      headersJson: JSON.stringify(headers).slice(0, 20_000),
    }),
    db
      .update(mailbox)
      .set({
        lastReceivedAt: receivedAt,
        // 临时邮箱在考察期内收到首封邮件 → 永久保留
        ...(target.kind === 'temp' && target.retainedAt === null
          ? { expiresAt: null, retainedAt: receivedAt }
          : {}),
        updatedAt: now,
      })
      .where(eq(mailbox.id, target.id)),
    db
      .insert(dailyUsage)
      .values({
        id: idPart(),
        userId: target.userId,
        usageDate,
        sentCount: 0,
        receivedCount: 1,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [dailyUsage.userId, dailyUsage.usageDate],
        set: {
          receivedCount: sql`${dailyUsage.receivedCount} + 1`,
          updatedAt: now,
        },
      }),
  ]

  if (attachmentMetas.length > 0) {
    statements.push(
      db.insert(attachment).values(
        attachmentMetas.map((item) => ({
          id: idPart(),
          messageId,
          providerAttachmentId: item.providerAttachmentId,
          filename: item.filename,
          contentType: item.contentType,
          size: item.size,
          isInline: Boolean(item.contentId),
          contentId: item.contentId ?? null,
        })),
      ) as never,
    )
  }

  try {
    await db.batch(statements as never)
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      return { status: 'duplicate' }
    }
    throw error
  }

  // Telegram 推送是附加能力：不 await，避免 Telegram 抖动拖慢 Resend 的 webhook 响应；
  // Node 常驻进程会继续把推送跑完，失败只记日志。
  void notifyInboundMessage(messageId).catch((error) => {
    console.error('[telegram] notify failed after ingest:', error)
  })

  return { status: 'stored', messageId }
}
