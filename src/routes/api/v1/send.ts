import { createFileRoute } from '@tanstack/react-router'

import { authenticateApiKey } from '#/server/auth/api-key'
import { AppError } from '#/server/errors'
import { sendMail } from '#/server/mail/send'

function fail(error: unknown) {
  if (error instanceof AppError) {
    return Response.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  console.error('[api/v1/send]', error)
  return Response.json(
    { ok: false, error: { code: 'internal', message: '发送失败' } },
    { status: 500 },
  )
}

export const Route = createFileRoute('/api/v1/send')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { user, mailboxId } = await authenticateApiKey(request)
          const body = (await request.json()) as {
            fromMailboxId?: string
            from?: string
            to: string | string[]
            cc?: string | string[]
            bcc?: string | string[]
            subject?: string
            text?: string
            html?: string
            attachments?: {
              filename: string
              content: string
              contentType?: string
            }[]
          }

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
          })

          return Response.json({ ok: true, data: result })
        } catch (error) {
          return fail(error)
        }
      },
    },
  },
})
