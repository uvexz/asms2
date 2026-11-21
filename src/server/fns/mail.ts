import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireVerifiedUser } from '#/server/auth/guards'
import { attempt } from '#/server/errors'
import {
  createMailbox,
  listMailboxes,
  listSelectableDomains,
  removeMailbox,
  updateMailboxProfile,
} from '#/server/mail/mailbox'
import { getMessage, listMessages, updateMessage } from '#/server/mail/message'
import { getSendUsage, usageDateFor } from '#/server/mail/quota'
import { sendMail } from '#/server/mail/send'
import { getSiteSettings } from '#/server/settings'

export const listMailboxesFn = createServerFn({ method: 'GET' }).handler(
  async () =>
    attempt(async () => {
      const user = await requireVerifiedUser()
      return listMailboxes(user.id)
    }),
)

const createMailboxSchema = z.object({
  kind: z.enum(['permanent', 'temp']),
  localPart: z.string().min(1).max(32),
  domainId: z.string().optional(),
  displayName: z.string().max(60).optional(),
})

export const createMailboxFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => createMailboxSchema.parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const user = await requireVerifiedUser()
      return createMailbox(user.id, {
        kind: data.kind,
        localPart: data.localPart,
        domainId: data.domainId,
        displayName: data.displayName,
        mailboxLimit: user.mailboxLimit,
        allowReserved: user.role === 'admin',
      })
    }),
  )

export const removeMailboxFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const user = await requireVerifiedUser()
      return removeMailbox(user.id, data.id)
    }),
  )

export const renameMailboxFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z
      .object({ id: z.string(), displayName: z.string().max(60).nullable() })
      .parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      const user = await requireVerifiedUser()
      return updateMailboxProfile(user.id, data.id, {
        displayName: data.displayName,
      })
    }),
  )

export const listDomainsFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z.object({ kind: z.enum(['permanent', 'temp']) }).parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      await requireVerifiedUser()
      const settings = await getSiteSettings()
      if (!settings.allowUserDomainChoice) return []
      return listSelectableDomains(data.kind)
    }),
  )

const listMessagesSchema = z.object({
  mailboxId: z.string().optional(),
  folder: z.enum(['inbox', 'sent', 'trash', 'spam', 'archive']),
  q: z.string().max(100).optional(),
  cursor: z.string().optional(),
})

export const listMessagesFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => listMessagesSchema.parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const user = await requireVerifiedUser()
      return listMessages(user.id, data)
    }),
  )

export const getMessageFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const user = await requireVerifiedUser()
      return getMessage(user.id, data.id)
    }),
  )

const updateMessageSchema = z.object({
  id: z.string(),
  isRead: z.boolean().optional(),
  isStarred: z.boolean().optional(),
  folder: z.enum(['inbox', 'sent', 'trash', 'spam', 'archive']).optional(),
})

export const updateMessageFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => updateMessageSchema.parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const user = await requireVerifiedUser()
      // 三种变更合并为单条 UPDATE，避免串行写三次
      return updateMessage(user.id, data.id, {
        isRead: data.isRead,
        isStarred: data.isStarred,
        folder: data.folder,
      })
    }),
  )

// 收件人总数在 sendMail 里按 to + cc + bcc 合并校验；这里只挡住超大载荷
const recipientField = z.union([
  z.string().max(4_000),
  z.array(z.string().max(320)).max(20),
])

const sendSchema = z.object({
  fromMailboxId: z.string(),
  to: recipientField,
  cc: recipientField.optional(),
  bcc: recipientField.optional(),
  subject: z.string().max(200).optional(),
  text: z.string().max(100_000).optional(),
  html: z.string().max(200_000).optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(200),
        // 10MB 附件的 base64 约 13.4M 字符，留一点余量
        content: z.string().max(14_000_000),
        contentType: z.string().max(100).optional(),
      }),
    )
    .max(3)
    .optional(),
})

export const sendMailFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => sendSchema.parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const user = await requireVerifiedUser()
      return sendMail(user, data)
    }),
  )

export const getQuotaFn = createServerFn({ method: 'GET' }).handler(async () =>
  attempt(async () => {
    const user = await requireVerifiedUser()
    const settings = await getSiteSettings()
    const limit = user.sendLimit ?? settings.defaultDailySendLimit
    return getSendUsage(user.id, limit, usageDateFor(settings.timezone))
  }),
)
