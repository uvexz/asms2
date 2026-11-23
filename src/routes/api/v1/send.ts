import { createFileRoute } from '@tanstack/react-router'

import { authenticateApiKey } from '#/server/auth/api-key'
import { AppError } from '#/server/errors'
import { sendMail, getOutboundRequestStatus } from '#/server/mail/send'
import {
  apiErrorResponse,
  apiSendSchema,
  parseJsonBody,
} from '#/server/mail/validation'

export const Route = createFileRoute('/api/v1/send')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { user, mailboxId } = await authenticateApiKey(request)
          const url = new URL(request.url)
          const idempotencyKey = url.searchParams.get('idempotencyKey')?.trim()
          const fromMailboxId =
            mailboxId ?? url.searchParams.get('fromMailboxId')?.trim()
          if (!idempotencyKey || !fromMailboxId) {
            throw new AppError(
              'validation_failed',
              '查询发送状态需要 idempotencyKey 与 fromMailboxId',
            )
          }
          return Response.json({
            ok: true,
            data: await getOutboundRequestStatus(
              user.id,
              idempotencyKey,
              fromMailboxId,
            ),
          })
        } catch (error) {
          return apiErrorResponse(error)
        }
      },
      POST: async ({ request }) => {
        try {
          const { user, mailboxId } = await authenticateApiKey(request)
          // 3 个 10MB 附件经 base64 编码后约 40MB，再加正文与 JSON 结构。
          const body = await parseJsonBody(request, apiSendSchema, 45_000_000)

          const fromMailboxId = mailboxId ?? body.fromMailboxId
          if (!fromMailboxId) {
            throw new AppError(
              'validation_failed',
              '缺少 fromMailboxId（或该 Key 未绑定邮箱）',
            )
          }

          const result = await sendMail(user, {
            fromMailboxId,
            to: body.to,
            cc: body.cc,
            bcc: body.bcc,
            subject: body.subject,
            text: body.text,
            html: body.html,
            attachments: body.attachments,
            idempotencyKey: body.idempotencyKey,
          })

          return Response.json({ ok: true, data: result })
        } catch (error) {
          return apiErrorResponse(error)
        }
      },
    },
  },
})
