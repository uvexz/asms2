import { createFileRoute } from '@tanstack/react-router'

import { authenticateApiKey } from '#/server/auth/api-key'
import { AppError } from '#/server/errors'
import { getMessage, listMessages } from '#/server/mail/message'
import {
  apiErrorResponse,
  apiMessagesQuerySchema,
  parseSchema,
} from '#/server/mail/validation'

export const Route = createFileRoute('/api/v1/messages')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { user, mailboxId: scoped } = await authenticateApiKey(request)
          const url = new URL(request.url)
          const query = parseSchema(
            apiMessagesQuerySchema,
            Object.fromEntries(url.searchParams),
          )
          const { id } = query

          if (id) {
            const detail = await getMessage(user.id, id)
            // Key 绑定到单个邮箱时，详情也必须在作用域内，不能靠猜 ID 越权读取
            if (scoped && detail.mailboxId !== scoped) {
              throw new AppError('forbidden', '该 API Key 无权访问此邮件', 403)
            }
            return Response.json({ ok: true, data: detail })
          }

          const result = await listMessages(user.id, {
            mailboxId: scoped ?? query.mailboxId,
            folder: query.folder,
            q: query.q,
            cursor: query.cursor,
            limit: query.limit,
          })
          return Response.json({ ok: true, data: result })
        } catch (error) {
          return apiErrorResponse(error)
        }
      },
    },
  },
})
