import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireUser } from '#/server/auth/guards'
import { attempt } from '#/server/errors'
import {
  createMailbox,
  listMailboxes,
  listSelectableDomains,
  removeMailbox,
  updateMailboxProfile,
} from '#/server/mail/mailbox'
import {
  getMessage,
  listMessages,
  markRead,
  moveMessage,
  toggleStar,
} from '#/server/mail/message'
import { getSendUsage, usageDateFor } from '#/server/mail/quota'
import { sendMail } from '#/server/mail/send'
import { getSiteSettings } from '#/server/settings'

export const listMailboxesFn = createServerFn({ method: 'GET' }).handler(
  async () =>
    attempt(async () => {
      const user = await requireUser()
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
      const user = await requireUser()
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
      const user = await requireUser()
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
      const user = await requireUser()
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
      await requireUser()
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
      const user = await requireUser()
      return listMessages(user.id, data)
    }),
  )

export const getMessageFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const user = await requireUser()
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
      const user = await requireUser()
      if (typeof data.isRead === 'boolean') {
        await markRead(user.id, data.id, data.isRead)
      }
      if (typeof data.isStarred === 'boolean') {
        await toggleStar(user.id, data.id, data.isStarred)
      }
      if (data.folder) {
        await moveMessage(user.id, data.id, data.folder)
      }
      return { id: data.id }
    }),
  )

const sendSchema = z.object({
  fromMailboxId: z.string(),
  to: z.union([z.string(), z.array(z.string())]),
  cc: z.union([z.string(), z.array(z.string())]).optional(),
  bcc: z.union([z.string(), z.array(z.string())]).optional(),
  subject: z.string().max(200).optional(),
  text: z.string().max(100_000).optional(),
  html: z.string().max(200_000).optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().max(200),
        content: z.string(),
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
      const user = await requireUser()
      return sendMail(user, data)
    }),
  )

export const getQuotaFn = createServerFn({ method: 'GET' }).handler(async () =>
  attempt(async () => {
    const user = await requireUser()
    const settings = await getSiteSettings()
    const limit = user.sendLimit ?? settings.defaultDailySendLimit
    return getSendUsage(user.id, limit, usageDateFor(settings.timezone))
  }),
)
