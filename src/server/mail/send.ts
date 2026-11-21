import { eq } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'

import { db } from '#/db/client'
import {
  attachment,
  mailbox,
  message,
  messageBody,
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
import { resolveSendProviderForDomain } from './provider-config'
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

export interface SendMailInput {
  fromMailboxId: string
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

export async function sendMail(user: SessionUser, input: SendMailInput) {
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

  const limit = user.sendLimit ?? settings.defaultDailySendLimit
  const usageDate = usageDateFor(settings.timezone)
  const reserved = await reserveSendQuota(user.id, limit, usageDate)
  if (!reserved) {
    throw new AppError(
      'quota_exceeded',
      `今日发件额度已用完（${limit} 封/天）`,
      429,
    )
  }

  let resolved: Awaited<ReturnType<typeof resolveSendProviderForDomain>>
  try {
    resolved = await resolveSendProviderForDomain(box.domainId)
  } catch (error) {
    await refundSendQuota(user.id, usageDate)
    throw error
  }

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
    attachments: attachments.map((item) => ({
      filename: item.filename,
      content: item.content,
      contentType: item.contentType,
    })),
    idempotencyKey: `send/${box.id}/${idPart()}`,
  }

  let providerMessageId: string
  try {
    const result = await resolved.provider.send(outbound, resolved.runtime)
    providerMessageId = result.providerMessageId
  } catch (error) {
    if (error instanceof ProviderError && !error.retryable) {
      await refundSendQuota(user.id, usageDate)
    }
    if (error instanceof ProviderError) {
      throw new AppError('provider_error', `发送失败：${error.message}`, 502)
    }
    throw error
  }

  const now = new Date()
  const messageId = idPart()
  const plain = text ?? ''
  const snippet = makeSnippet(plain)

  const statements = [
    db.insert(message).values({
      id: messageId,
      userId: user.id,
      mailboxId: box.id,
      direction: 'outbound',
      folder: 'sent',
      providerConfigId: resolved.config.id,
      providerMessageId,
      internetMessageId: null,
      threadKey: null,
      fromName: box.displayName ?? user.name,
      fromAddress: box.address,
      toJson: JSON.stringify(to.map((item) => item.address)),
      ccJson: cc.length ? JSON.stringify(cc.map((item) => item.address)) : null,
      bccJson: bcc.length
        ? JSON.stringify(bcc.map((item) => item.address))
        : null,
      replyToJson: JSON.stringify([box.address]),
      subject,
      snippet,
      status: 'sent',
      isRead: true,
      isStarred: false,
      hasAttachments: attachments.length > 0,
      attachmentCount: attachments.length,
      size: new TextEncoder().encode(html).length + attachmentBytes,
      sentAt: now,
      receivedAt: now,
      createdAt: now,
    }),
    db.insert(messageBody).values({
      messageId,
      htmlRaw: html,
      // 与收件同一条规则：入库展示用的 HTML 一律先净化
      htmlSanitized: sanitizeEmailHtml(html),
      textBody: plain,
      headersJson: null,
    }),
    db
      .update(mailbox)
      .set({ lastSentAt: now, updatedAt: now })
      .where(eq(mailbox.id, box.id)),
  ]

  if (attachments.length > 0) {
    statements.push(
      db.insert(attachment).values(
        attachments.map((item) => ({
          id: idPart(),
          messageId,
          providerAttachmentId: null,
          filename: item.filename,
          contentType: item.contentType ?? 'application/octet-stream',
          size: Math.ceil((item.content.length * 3) / 4),
          isInline: false,
          contentId: null,
        })),
      ) as never,
    )
  }

  await db.batch(statements as never)

  return {
    id: messageId,
    providerMessageId,
    subject,
    to: to.map((item) => item.address),
  }
}
