import { createFileRoute } from '@tanstack/react-router'

import { authenticateApiKey } from '#/server/auth/api-key'
import { AppError } from '#/server/errors'
import { createMailbox, listMailboxes } from '#/server/mail/mailbox'
import {
  apiCreateMailboxSchema,
  apiErrorResponse,
  parseJsonBody,
} from '#/server/mail/validation'

export const Route = createFileRoute('/api/v1/mailboxes')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { user, mailboxId: scoped } = await authenticateApiKey(request)
          const offset = Number(
            new URL(request.url).searchParams.get('offset') ?? 0,
          )
          const rows = await listMailboxes(
            user.id,
            Number.isSafeInteger(offset) && offset > 0
              ? Math.min(offset, 100_000)
              : 0,
          )
          // Key 绑定单邮箱时只暴露该邮箱，避免枚举同账号下的其他地址
          const data = scoped ? rows.filter((row) => row.id === scoped) : rows
          return Response.json({ ok: true, data })
        } catch (error) {
          return apiErrorResponse(error)
        }
      },
      POST: async ({ request }) => {
        try {
          const { user, mailboxId: scoped } = await authenticateApiKey(request)
          if (scoped) {
            throw new AppError(
              'forbidden',
              '该 API Key 绑定了单个邮箱，不能新建邮箱',
              403,
            )
          }
          const body = await parseJsonBody(request, apiCreateMailboxSchema)
          const row = await createMailbox(user.id, {
            kind: body.kind,
            localPart: body.localPart,
            domainId: body.domainId,
            displayName: body.displayName,
            mailboxLimit: user.mailboxLimit,
            allowReserved: user.role === 'admin',
          })
          return Response.json({ ok: true, data: row }, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error)
        }
      },
    },
  },
})
