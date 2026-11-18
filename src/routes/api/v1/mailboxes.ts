import { createFileRoute } from '@tanstack/react-router'

import { authenticateApiKey } from '#/server/auth/api-key'
import { AppError } from '#/server/errors'
import { createMailbox, listMailboxes } from '#/server/mail/mailbox'

function fail(error: unknown) {
  if (error instanceof AppError) {
    return Response.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  return Response.json(
    { ok: false, error: { code: 'internal', message: '操作失败' } },
    { status: 500 },
  )
}

export const Route = createFileRoute('/api/v1/mailboxes')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { user } = await authenticateApiKey(request)
          const rows = await listMailboxes(user.id)
          return Response.json({ ok: true, data: rows })
        } catch (error) {
          return fail(error)
        }
      },
      POST: async ({ request }) => {
        try {
          const { user } = await authenticateApiKey(request)
          const body = (await request.json()) as {
            kind?: 'permanent' | 'temp'
            localPart?: string
            domainId?: string
            displayName?: string
          }
          if (!body.localPart) {
            throw new AppError('validation_failed', '缺少 localPart')
          }
          const row = await createMailbox(user.id, {
            kind: body.kind ?? 'permanent',
            localPart: body.localPart,
            domainId: body.domainId,
            displayName: body.displayName,
            mailboxLimit: user.mailboxLimit,
          })
          return Response.json({ ok: true, data: row }, { status: 201 })
        } catch (error) {
          return fail(error)
        }
      },
    },
  },
})
