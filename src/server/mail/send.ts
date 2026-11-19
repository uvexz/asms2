import { eq } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'

import { db } from '#/db/client'
import { attachment, mailbox, message, messageBody } from '#/db/schema'
import { AppError } from '#/server/errors'
import { ProviderError, type OutboundMessage } from '#/server/providers'
import type { SessionUser } from '#/server/auth/guards'
import { getSiteSettings } from '#/server/settings'
import { parseAddressList, type ParsedAddress } from '#/lib/email-address'

import { makeSnippet, textToHtml } from './content'
import { getMailboxOrThrow } from './mailbox'
import { resolveSendProviderForDomain } from './provider-config'
import { refundSendQuota, reserveSendQuota, usageDateFor } from './quota'

const idPart = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 20)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_ATTACHMENTS = 3
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
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
    filename: string
    content: string
    contentType?: string
  }[]
}

function assertAddresses(list: ParsedAddress[], label: string) {
  if (list.length === 0) {
    throw new AppError('validation_failed', `请填写${label}`)
  }
  if (list.length > MAX_RECIPIENTS) {
    throw new AppError('validation_failed', `${label}最多 ${MAX_RECIPIENTS} 个`)
  }
  for (const item of list) {
    if (!EMAIL_RE.test(item.address)) {
      throw new AppError('validation_failed', `收件地址不合法：${item.address}`)
    }
  }
}

export async function sendMail(user: SessionUser, input: SendMailInput) {
  const [settings, box] = await Promise.all([
    getSiteSettings(),
    getMailboxOrThrow(user.id, input.fromMailboxId),
  ])

  if (box.kind === 'temp' && !settings.allowTempSend) {
    throw new AppError('forbidden', '临时邮箱不支持发信', 403)
  }

  const to = parseAddressList(input.to)
  const cc = parseAddressList(input.cc)
  const bcc = parseAddressList(input.bcc)
  assertAddresses(to, '收件人')

  const subject = (input.subject ?? '').trim() || '(无主题)'
  const text = input.text?.trim() ? input.text : undefined
  if (!text && !input.html) {
    throw new AppError('validation_failed', '邮件内容不能为空')
  }

  const attachments = input.attachments ?? []
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new AppError('validation_failed', `附件最多 ${MAX_ATTACHMENTS} 个`)
  }

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
      name: box.displayName ?? user.name ?? undefined,
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
      fromName: box.displayName ?? user.name ?? null,
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
      htmlSanitized: html,
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
