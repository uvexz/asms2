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

const FOLDERS = ['inbox', 'sent', 'trash', 'spam', 'archive'] as const
type Folder = (typeof FOLDERS)[number]

function parseLimit(raw: string | null): number {
  if (raw === null) return 30
  const value = Number(raw)
  // ?limit=abc 得到 NaN，必须显式回退，否则 NaN 会一路传到 SQL
  if (!Number.isFinite(value)) return 30
  return Math.min(Math.max(Math.trunc(value), 1), 50)
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
            // Key 绑定到单个邮箱时，详情也必须在作用域内，不能靠猜 ID 越权读取
            if (scoped && detail.mailboxId !== scoped) {
              throw new AppError('forbidden', '该 API Key 无权访问此邮件', 403)
            }
            return Response.json({ ok: true, data: detail })
          }

          const folderParam = url.searchParams.get('folder') ?? 'inbox'
          const folder = (FOLDERS as readonly string[]).includes(folderParam)
            ? (folderParam as Folder)
            : 'inbox'

          const result = await listMessages(user.id, {
            mailboxId: scoped ?? url.searchParams.get('mailboxId') ?? undefined,
            folder,
            q: url.searchParams.get('q') ?? undefined,
            cursor: url.searchParams.get('cursor') ?? undefined,
            limit: parseLimit(url.searchParams.get('limit')),
          })
          return Response.json({ ok: true, data: result })
        } catch (error) {
          return fail(error)
        }
      },
    },
  },
})
