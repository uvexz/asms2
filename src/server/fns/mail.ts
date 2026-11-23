import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireVerifiedUser } from '#/server/auth/guards'
import { attempt } from '#/server/errors'
import {
  createMailboxSchema,
  listMessagesSchema,
  sendSchema,
  updateMessageSchema,
} from '#/server/mail/validation'
import {
  createMailbox,
  listMailboxes,
  listSelectableDomains,
  removeMailbox,
  updateMailboxProfile,
  getMailboxOrThrow,
} from '#/server/mail/mailbox'
import { getMessage, listMessages, updateMessage } from '#/server/mail/message'
import { getSendUsage, usageDateFor } from '#/server/mail/quota'
import { sendMail, getOutboundRequestStatus } from '#/server/mail/send'
import { getSiteSettings } from '#/server/settings'

export const listMailboxesFn = createServerFn({ method: 'GET' }).handler(
  async () =>
    attempt(async () => {
      const user = await requireVerifiedUser()
      return listMailboxes(user.id)
    }),
)

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

export const sendMailFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => sendSchema.parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const user = await requireVerifiedUser()
      return sendMail(user, data)
    }),
  )

export const getSendStatusFn = createServerFn({ method: 'GET' })
  .validator((data: unknown) =>
    z
      .object({
        fromMailboxId: z.string(),
        idempotencyKey: z.string().min(8).max(200),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      const user = await requireVerifiedUser()
      await getMailboxOrThrow(user.id, data.fromMailboxId)
      return getOutboundRequestStatus(
        user.id,
        data.idempotencyKey,
        data.fromMailboxId,
      )
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
