import { createHash } from 'node:crypto'

import { and, eq, lt, sql } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'

import { db } from '#/db/client'
import {
  attachment,
  mailbox,
  message,
  messageBody,
  outboundRequest,
  user as userTable,
} from '#/db/schema'
import { AppError } from '#/server/errors'
import { ProviderError } from '#/server/providers'
import type { OutboundMessage } from '#/server/providers'
import type { SessionUser } from '#/server/auth/guards'
import { getSiteSettings } from '#/server/settings'
import { parseAddressList } from '#/lib/email-address'
import type { ParsedAddress } from '#/lib/email-address'

import { makeSnippet, sanitizeEmailHtml, textToHtml } from './content'
import { getMailboxOrThrow } from './mailbox'
import {
  getProviderById,
  resolveSendProviderForDomain,
} from './provider-config'
import { refundSendQuota, reserveSendQuota, usageDateFor } from './quota'

const idPart = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 20)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/
const CONTENT_TYPE_RE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i
const MAX_ATTACHMENTS = 3
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
/** to + cc + bcc 去重后的总人数上限；配额按封计，必须限制单封的扇出 */
const MAX_RECIPIENTS = 20
const MAX_DISPATCH_ATTEMPTS = 5
const QUOTA_FAILURE = 'quota_reservation_failed'

export interface SendMailInput {
  fromMailboxId: string
  /** 与第一次提交完全相同的幂等键；缺省时服务端生成并随首次结果返回。 */
  idempotencyKey?: string
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  subject?: string
  text?: string
  html?: string
  attachments?: {
    /** 来自客户端载荷，运行期可能缺失，由 sendMail 内部逐项校验 */
    filename?: string
    content?: string
    contentType?: string
  }[]
}

export interface SendMailResult {
  id: string
  providerMessageId: string
  subject: string
  to: string[]
  idempotencyKey: string
  replayed?: boolean
}

type StoredOutboundRequest = typeof outboundRequest.$inferSelect

function assertAddressFormat(list: ParsedAddress[]) {
  for (const item of list) {
    if (!EMAIL_RE.test(item.address)) {
      throw new AppError('validation_failed', `收件地址不合法：${item.address}`)
    }
  }
}

function assertRecipients(
  to: ParsedAddress[],
  cc: ParsedAddress[],
  bcc: ParsedAddress[],
) {
  if (to.length === 0) {
    throw new AppError('validation_failed', '请填写收件人')
  }
  assertAddressFormat(to)
  assertAddressFormat(cc)
  assertAddressFormat(bcc)

  const unique = new Set(
    [...to, ...cc, ...bcc].map((item) => item.address.toLowerCase()),
  )
  if (unique.size > MAX_RECIPIENTS) {
    throw new AppError(
      'validation_failed',
      `收件人、抄送、密送合计最多 ${MAX_RECIPIENTS} 个`,
    )
  }
}

/** 去掉路径分隔符与控制字符，避免服务商或收件端把文件名当路径解释 */
function sanitizeFilename(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim()
    .slice(0, 200)
  return cleaned || 'attachment'
}

function normalizeContentType(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (!CONTENT_TYPE_RE.test(trimmed)) {
    throw new AppError('validation_failed', `附件类型不合法：${trimmed}`)
  }
  return trimmed.toLowerCase()
}

/**
 * 新账号发信冷却：批量注册的小号拿到账号后不能立刻群发，
 * 给管理员留出发现和封禁的时间。管理员不受限制；冷却设为 0 即关闭。
 */
async function assertSendCooldownPassed(
  user: SessionUser,
  cooldownHours: number,
) {
  if (cooldownHours <= 0 || user.role === 'admin') return

  const row = (
    await db
      .select({ createdAt: userTable.createdAt })
      .from(userTable)
      .where(eq(userTable.id, user.id))
      .limit(1)
  ).at(0)
  if (!row) throw new AppError('unauthorized', '账号不存在', 401)

  const readyAt = row.createdAt.getTime() + cooldownHours * 3600 * 1000
  const remainingMs = readyAt - Date.now()
  if (remainingMs <= 0) return

  const remainingHours = Math.ceil(remainingMs / 3600_000)
  throw new AppError(
    'forbidden',
    `新注册账号需等待 ${cooldownHours} 小时后才能发信，还需约 ${remainingHours} 小时`,
    403,
  )
}

/**
 * 同一原始键在数据库里按邮箱命名空间化，避免两个邮箱使用同名键互相冲突；
 * 对外仍返回原始键，客户端重试时原值照传即可。
 */
export function outboundIdempotencyKey(key: string, mailboxId: string): string {
  return `user/${mailboxId}/${createHash('sha256').update(key).digest('hex').slice(0, 40)}`
}

function requestFingerprint(input: {
  userId: string
  mailboxId: string
  outbound: OutboundMessage
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        userId: input.userId,
        mailboxId: input.mailboxId,
        from: input.outbound.from,
        to: input.outbound.to,
        cc: input.outbound.cc,
        bcc: input.outbound.bcc,
        replyTo: input.outbound.replyTo,
        subject: input.outbound.subject,
        text: input.outbound.text,
        html: input.outbound.html,
        attachments: input.outbound.attachments,
      }),
    )
    .digest('hex')
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : '内部错误').slice(0, 500)
}

function uncertainError(requestId: string, detail?: string): AppError {
  return new AppError(
    'send_uncertain',
    detail ??
      `发送结果尚未确认，系统保留了原请求。请使用相同幂等键查询或重试，不要重新创建邮件（请求 ${requestId}）`,
    503,
  )
}

async function findRequestByKey(
  key: string,
): Promise<StoredOutboundRequest | undefined> {
  return (
    await db
      .select()
      .from(outboundRequest)
      .where(eq(outboundRequest.idempotencyKey, key))
      .limit(1)
  ).at(0)
}

async function findRequestById(
  id: string,
): Promise<StoredOutboundRequest | undefined> {
  return (
    await db
      .select()
      .from(outboundRequest)
      .where(eq(outboundRequest.id, id))
      .limit(1)
  ).at(0)
}

/** 原子抢占首次派发：只有 pending 且未超尝试上限的请求能进入 processing。 */
async function claimDispatch(
  request: StoredOutboundRequest,
): Promise<StoredOutboundRequest | null> {
  const now = new Date()
  const rows = await db
    .update(outboundRequest)
    .set({
      status: 'processing',
      attempts: sql`${outboundRequest.attempts} + 1`,
      error: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(outboundRequest.id, request.id),
        eq(outboundRequest.status, 'pending'),
        lt(outboundRequest.attempts, MAX_DISPATCH_ATTEMPTS),
      ),
    )
    .returning()
  return rows[0] ?? null
}

/** 明确拒绝时先标记 failed，再用一次 CAS 领取退款资格，避免重复退款。 */
async function failWithRefund(
  request: StoredOutboundRequest,
  user: SessionUser,
  error: string,
): Promise<void> {
  const marked = await db
    .update(outboundRequest)
    .set({ status: 'failed', error, updatedAt: new Date() })
    .where(
      and(
        eq(outboundRequest.id, request.id),
        eq(outboundRequest.status, 'processing'),
      ),
    )
    .returning({ id: outboundRequest.id })
  if (marked.length === 0) return

  if (!request.quotaReserved) return
  const won = await db
    .update(outboundRequest)
    .set({ quotaReserved: false })
    .where(
      and(
        eq(outboundRequest.id, request.id),
        eq(outboundRequest.quotaReserved, true),
      ),
    )
    .returning({ id: outboundRequest.id })
  if (won.length === 0) return
  try {
    await refundSendQuota(user.id, request.usageDate)
  } catch (refundError) {
    // 退款失败时把资格放回，交给 sweep 对账；不能吞掉请求记录里的标记。
    await db
      .update(outboundRequest)
      .set({
        quotaReserved: true,
        error: `${error}；配额退款失败：${safeError(refundError)}`,
      })
      .where(eq(outboundRequest.id, request.id))
    throw refundError
  }
}

async function messageExists(messageId: string): Promise<boolean> {
  return Boolean(
    (
      await db
        .select({ id: message.id })
        .from(message)
        .where(eq(message.id, messageId))
        .limit(1)
    ).at(0),
  )
}

/**
 * 服务商已经受理后的本地完成阶段。此函数绝不调用服务商，
 * 因此可安全地由同键请求、进程重启后的恢复流程反复调用。
 */
async function finalizeAcceptedRequest(
  request: StoredOutboundRequest,
  rawKey: string,
): Promise<SendMailResult> {
  const providerMessageId = request.providerMessageId
  if (!providerMessageId) {
    throw uncertainError(request.id)
  }

  const payload = JSON.parse(request.payloadJson) as OutboundMessage
  const messageId = request.id
  const now = new Date()

  if (!(await messageExists(messageId))) {
    const storedAttachments = payload.attachments ?? []
    const statements = [
      db.insert(message).values({
        id: messageId,
        userId: request.userId,
        mailboxId: request.mailboxId,
        direction: 'outbound',
        folder: 'sent',
        providerConfigId: request.providerConfigId,
        providerMessageId,
        internetMessageId: null,
        threadKey: null,
        fromName: payload.from.name ?? null,
        fromAddress: payload.from.address,
        toJson: JSON.stringify(payload.to.map((item) => item.address)),
        ccJson:
          (payload.cc?.length ?? 0) > 0
            ? JSON.stringify(payload.cc?.map((item) => item.address))
            : null,
        bccJson:
          (payload.bcc?.length ?? 0) > 0
            ? JSON.stringify(payload.bcc?.map((item) => item.address))
            : null,
        replyToJson: JSON.stringify(
          payload.replyTo?.map((item) => item.address) ?? [],
        ),
        subject: payload.subject,
        snippet: makeSnippet(payload.text ?? ''),
        status: 'sent',
        isRead: true,
        isStarred: false,
        hasAttachments: storedAttachments.length > 0,
        attachmentCount: storedAttachments.length,
        size:
          new TextEncoder().encode(payload.html ?? payload.text ?? '').length +
          storedAttachments.reduce(
            (sum, item) => sum + Math.ceil((item.content.length * 3) / 4),
            0,
          ),
        sentAt: now,
        receivedAt: now,
        createdAt: now,
      }),
      db.insert(messageBody).values({
        messageId,
        htmlRaw: payload.html ?? null,
        htmlSanitized: sanitizeEmailHtml(payload.html ?? payload.text ?? ''),
        textBody: payload.text ?? null,
        headersJson: null,
      }),
      ...storedAttachments.map((item) =>
        db.insert(attachment).values({
          id: idPart(),
          messageId,
          providerAttachmentId: null,
          filename: item.filename,
          contentType: item.contentType ?? 'application/octet-stream',
          size: Math.ceil((item.content.length * 3) / 4),
          isInline: false,
          contentId: null,
        }),
      ),
      db
        .update(mailbox)
        .set({ lastSentAt: now, updatedAt: now })
        .where(eq(mailbox.id, request.mailboxId)),
    ]

    try {
      await db.batch(statements as never)
    } catch (error) {
      // 并发 finalize 时另一个请求已经写入同一 message：继续完成状态即可。
      if (!(await messageExists(messageId))) {
        await db
          .update(outboundRequest)
          .set({ error: safeError(error), updatedAt: new Date() })
          .where(eq(outboundRequest.id, request.id))
        throw uncertainError(
          request.id,
          '邮件已由服务商受理，但本地记录尚未完成；请用相同幂等键重试',
        )
      }
    }
  }

  await db
    .update(outboundRequest)
    .set({
      status: 'succeeded',
      messageId,
      providerMessageId,
      error: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(outboundRequest.id, request.id),
        sql`${outboundRequest.status} in ('submitted','uncertain')`,
      ),
    )

  return {
    id: messageId,
    providerMessageId,
    subject: payload.subject,
    to: payload.to.map((item) => item.address),
    idempotencyKey: rawKey,
  }
}

export async function sendMail(
  user: SessionUser,
  input: SendMailInput,
): Promise<SendMailResult> {
  const [settings, box] = await Promise.all([
    getSiteSettings(),
    getMailboxOrThrow(user.id, input.fromMailboxId),
  ])

  await assertSendCooldownPassed(user, settings.newAccountSendCooldownHours)

  if (box.kind === 'temp' && !settings.allowTempSend) {
    throw new AppError('forbidden', '临时邮箱不支持发信', 403)
  }

  const to = parseAddressList(input.to)
  const cc = parseAddressList(input.cc)
  const bcc = parseAddressList(input.bcc)
  assertRecipients(to, cc, bcc)

  const subject = (input.subject ?? '').trim() || '(无主题)'
  const text = input.text?.trim() ? input.text : undefined
  if (!text && !input.html) {
    throw new AppError('validation_failed', '邮件内容不能为空')
  }

  const rawAttachments = input.attachments ?? []
  if (rawAttachments.length > MAX_ATTACHMENTS) {
    throw new AppError('validation_failed', `附件最多 ${MAX_ATTACHMENTS} 个`)
  }
  const attachments = rawAttachments.map((item) => {
    const content = (item.content ?? '').replace(/\s+/g, '')
    if (!content || content.length % 4 !== 0 || !BASE64_RE.test(content)) {
      throw new AppError('validation_failed', '附件内容必须是合法的 base64')
    }
    return {
      filename: sanitizeFilename(String(item.filename ?? '')),
      content,
      contentType: normalizeContentType(item.contentType),
    }
  })

  let attachmentBytes = 0
  for (const item of attachments) {
    const bytes = Math.ceil((item.content.length * 3) / 4)
    attachmentBytes += bytes
    if (bytes > MAX_ATTACHMENT_BYTES) {
      throw new AppError('validation_failed', '单个附件不能超过 10MB')
    }
  }
  if (attachmentBytes > MAX_ATTACHMENT_BYTES) {
    throw new AppError('validation_failed', '附件总大小不能超过 10MB')
  }

  const rawKey = input.idempotencyKey?.trim() || randomKey(box.id)
  if (rawKey.length < 8 || rawKey.length > 200 || /\s/.test(rawKey)) {
    throw new AppError('validation_failed', '幂等键长度或格式不正确')
  }
  const idempotencyKey = outboundIdempotencyKey(rawKey, box.id)
  const html = input.html ?? textToHtml(text ?? '')
  const outbound: OutboundMessage = {
    from: {
      address: box.address,
      name: box.displayName ?? user.name,
    },
    to,
    cc,
    bcc,
    replyTo: [{ address: box.address }],
    subject,
    text,
    html,
    attachments,
    idempotencyKey,
  }
  const requestHash = requestFingerprint({
    userId: user.id,
    mailboxId: box.id,
    outbound,
  })

  const limit = user.sendLimit ?? settings.defaultDailySendLimit
  const usageDate = usageDateFor(settings.timezone)

  for (let pass = 0; pass < 2; pass += 1) {
    let request: StoredOutboundRequest | null =
      (await findRequestByKey(idempotencyKey)) ?? null

    if (!request) {
      // 只有真正要新建请求时才解析服务商；恢复已受理请求不需要它。
      const resolved = await resolveSendProviderForDomain(box.domainId)
      const inserted = await db
        .insert(outboundRequest)
        .values({
          id: idPart(),
          idempotencyKey,
          requestHash,
          userId: user.id,
          mailboxId: box.id,
          providerConfigId: resolved.config.id,
          payloadJson: JSON.stringify(outbound),
          status: 'pending',
          attempts: 0,
          usageDate,
          quotaReserved: false,
        })
        .onConflictDoNothing()
        .returning()
      // 唯一键冲突后立刻同库读取，必然能读到另一请求写入的行。
      request = inserted[0] ?? (await findRequestByKey(idempotencyKey))!
    }

    if (request.userId !== user.id) {
      throw new AppError('conflict', '幂等键已被其他账号使用', 409)
    }
    if (request.requestHash !== requestHash) {
      throw new AppError(
        'conflict',
        '该幂等键已用于另一份邮件内容，不能复用',
        409,
      )
    }

    switch (request.status) {
      case 'succeeded':
        return {
          id: request.messageId ?? request.id,
          providerMessageId: request.providerMessageId ?? '',
          subject,
          to: to.map((item) => item.address),
          idempotencyKey: rawKey,
          replayed: true,
        }

      case 'failed':
        if (
          request.error === QUOTA_FAILURE &&
          !request.providerMessageId &&
          !request.quotaReserved
        ) {
          // 从未外呼、也从未扣额：删掉这条占位，让同一键在配额恢复后重新开始。
          await db
            .delete(outboundRequest)
            .where(
              and(
                eq(outboundRequest.id, request.id),
                eq(outboundRequest.status, 'failed'),
              ),
            )
          continue
        }
        throw new AppError(
          'provider_error',
          request.error ?? '服务商已拒绝发送',
          502,
        )

      case 'uncertain':
        if (!request.providerMessageId) {
          throw uncertainError(request.id)
        }
        return finalizeAcceptedRequest(request, rawKey)

      case 'submitted':
        return finalizeAcceptedRequest(request, rawKey)

      case 'processing': {
        // 其他请求正在派发。短暂等待，避免把“仍在进行”误报为已发送。
        for (let poll = 0; poll < 20; poll += 1) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          const latest = await findRequestById(request.id)
          if (!latest) throw new AppError('internal', '发送请求丢失', 500)
          if (latest.status !== 'processing') {
            return sendMail(user, {
              ...input,
              idempotencyKey: rawKey,
            })
          }
        }
        throw uncertainError(
          request.id,
          '邮件仍在发送中，请稍后用相同幂等键查询结果；不要重新创建邮件',
        )
      }

      case 'pending': {
        const claimed = await claimDispatch(request)
        if (!claimed) {
          const latest = await findRequestById(request.id)
          if (latest && latest.status !== 'pending') {
            request = latest
            pass -= 1
            continue
          }
          throw uncertainError(
            request.id,
            '发送请求正在处理，请稍后用相同幂等键查询结果',
          )
        }

        // 先解析服务商再扣配额：配置错误不应消耗当天额度。
        let resolved: Awaited<ReturnType<typeof getProviderById>>
        try {
          resolved = await getProviderById(claimed.providerConfigId)
        } catch (error) {
          await db
            .update(outboundRequest)
            .set({
              status: 'pending',
              error: safeError(error),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(outboundRequest.id, claimed.id),
                eq(outboundRequest.status, 'processing'),
              ),
            )
          throw error instanceof AppError
            ? error
            : new AppError('provider_error', '服务商配置不可用', 503)
        }

        const reserved = await reserveSendQuota(user.id, limit, usageDate)
        if (!reserved) {
          await db
            .update(outboundRequest)
            .set({
              status: 'failed',
              error: QUOTA_FAILURE,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(outboundRequest.id, claimed.id),
                eq(outboundRequest.status, 'processing'),
              ),
            )
          throw new AppError(
            'quota_exceeded',
            `今日发件额度已用完（${limit} 封/天）`,
            429,
          )
        }
        const chargedRows = await db
          .update(outboundRequest)
          .set({ quotaReserved: true, updatedAt: new Date() })
          .where(eq(outboundRequest.id, claimed.id))
          .returning()
        const charged = chargedRows[0] ?? claimed

        let providerMessageId: string
        try {
          const result = await resolved.provider.send(
            outbound,
            resolved.runtime,
          )
          providerMessageId = result.providerMessageId
        } catch (error) {
          if (error instanceof ProviderError && !error.retryable) {
            await failWithRefund(charged, user, safeError(error))
            throw new AppError(
              'provider_error',
              `发送失败：${error.message}`,
              502,
            )
          }
          // 超时、5xx、429、网络错误或适配器内部异常：结果未知，禁止自动重发。
          await db
            .update(outboundRequest)
            .set({
              status: 'uncertain',
              error: safeError(error),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(outboundRequest.id, claimed.id),
                eq(outboundRequest.status, 'processing'),
              ),
            )
          throw uncertainError(claimed.id)
        }

        const submitted = await db
          .update(outboundRequest)
          .set({
            status: 'submitted',
            providerMessageId,
            error: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(outboundRequest.id, claimed.id),
              eq(outboundRequest.status, 'processing'),
            ),
          )
          .returning()
        if (submitted.length === 0) {
          throw uncertainError(
            claimed.id,
            '服务商已返回消息 ID，但本地状态未能保存；请用相同幂等键重试',
          )
        }
        return finalizeAcceptedRequest(submitted[0], rawKey)
      }

      default:
        throw new AppError('internal', '未知的发送请求状态', 500)
    }
  }

  throw new AppError(
    'quota_exceeded',
    `今日发件额度已用完（${limit} 封/天）`,
    429,
  )
}

function randomKey(mailboxId: string): string {
  return `send/${mailboxId}/${idPart()}`
}

/** API 客户端可凭同键查询状态；只允许查询当前用户的请求。 */
export async function getOutboundRequestStatus(
  userId: string,
  idempotencyKey: string,
  mailboxId: string,
) {
  const row = (
    await db
      .select()
      .from(outboundRequest)
      .where(
        and(
          eq(
            outboundRequest.idempotencyKey,
            outboundIdempotencyKey(idempotencyKey, mailboxId),
          ),
          eq(outboundRequest.userId, userId),
          eq(outboundRequest.mailboxId, mailboxId),
        ),
      )
      .limit(1)
  ).at(0)
  if (!row) throw new AppError('not_found', '发送请求不存在', 404)
  return {
    id: row.messageId,
    requestId: row.id,
    status: row.status,
    providerMessageId: row.providerMessageId,
    error:
      row.status === 'uncertain'
        ? '发送结果待确认，请核对服务商后再决定是否重试'
        : row.error,
    attempts: row.attempts,
    updatedAt: row.updatedAt.getTime(),
  }
}
