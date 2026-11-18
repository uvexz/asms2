import { createFileRoute } from '@tanstack/react-router'

import { authenticateApiKey } from '#/server/auth/api-key'
import { AppError } from '#/server/errors'
import { getMessage, listMessages } from '#/server/mail/message'

function fail(error: unknown) {
  if (error instanceof AppError) {
    return Response.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  return Response.json(
    { ok: false, error: { code: 'internal', message: '读取失败' } },
    { status: 500 },
  )
}

export const Route = createFileRoute('/api/v1/messages')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { user, mailboxId: scoped } = await authenticateApiKey(request)
          const url = new URL(request.url)
          const id = url.searchParams.get('id')

          if (id) {
            const detail = await getMessage(user.id, id)
            return Response.json({ ok: true, data: detail })
          }

          const folder = (url.searchParams.get('folder') ?? 'inbox') as
            | 'inbox'
            | 'sent'
            | 'trash'
            | 'spam'
            | 'archive'

          const result = await listMessages(user.id, {
            mailboxId: scoped ?? url.searchParams.get('mailboxId') ?? undefined,
            folder,
            q: url.searchParams.get('q') ?? undefined,
            cursor: url.searchParams.get('cursor') ?? undefined,
            limit: Number(url.searchParams.get('limit') ?? 30),
          })
          return Response.json({ ok: true, data: result })
        } catch (error) {
          return fail(error)
        }
      },
    },
  },
})
