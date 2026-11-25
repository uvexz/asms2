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
} from '#/server/mail/mailbox'
import { getMessage, listMessages, updateMessage } from '#/server/mail/message'
import {
  getPermanentMailboxCount,
  getSendUsage,
  usageDateFor,
} from '#/server/mail/quota'
import { sendMail } from '#/server/mail/send'
import { getSiteSettings } from '#/server/settings'

export const listMailboxesFn = createServerFn({ method: 'GET' })
  .validator((data: unknown) =>
    z
      .object({
        offset: z.number().int().min(0).max(100_000).optional(),
      })
      .parse(data ?? {}),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      const user = await requireVerifiedUser()
      return listMailboxes(user.id, data.offset ?? 0)
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

export const listDomainsFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z.object({ kind: z.enum(['permanent', 'temp']) }).parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      await requireVerifiedUser()
      // 始终返回可用域名:关闭「允许用户选择」只是锁住选择,不能让弹窗拿不到默认域
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

export const getQuotaFn = createServerFn({ method: 'GET' }).handler(async () =>
  attempt(async () => {
    const user = await requireVerifiedUser()
    const settings = await getSiteSettings()
    const sendLimit = user.sendLimit ?? settings.defaultDailySendLimit
    const mailboxLimit = user.mailboxLimit ?? settings.defaultMailboxLimit
    const [sendUsage, mailboxUsed] = await Promise.all([
      getSendUsage(user.id, sendLimit, usageDateFor(settings.timezone)),
      getPermanentMailboxCount(user.id),
    ])
    return {
      ...sendUsage,
      mailboxUsed,
      mailboxLimit,
    }
  }),
)
