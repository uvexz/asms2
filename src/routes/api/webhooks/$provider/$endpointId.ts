import { createFileRoute } from '@tanstack/react-router'

import { AppError } from '#/server/errors'
import { ProviderError } from '#/server/providers'
import { processWebhook } from '#/server/webhooks/process'

export const Route = createFileRoute('/api/webhooks/$provider/$endpointId')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const rawBody = await request.text()
        const headers: Record<string, string> = {}
        request.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value
        })

        try {
          const result = await processWebhook({
            providerKind: params.provider,
            endpointId: params.endpointId,
            rawBody,
            headers,
          })
          return Response.json(result)
        } catch (error) {
          if (error instanceof AppError) {
            return Response.json(
              { ok: false, error: error.message },
              { status: error.status },
            )
          }
          if (error instanceof ProviderError) {
            // 验签失败＝不可重试，直接 401；载荷非法是 400，避免服务商无限重试
            const status =
              error.code === 'invalid_signature'
                ? 401
                : error.code === 'invalid_payload'
                  ? 400
                  : 502
            return Response.json(
              { ok: false, error: error.message },
              { status },
            )
          }
          // 其它错误返回 5xx 让服务商按退避策略重试
          console.error('[webhook] failed:', error)
          return Response.json(
            { ok: false, error: 'webhook processing failed' },
            { status: 500 },
          )
        }
      },
    },
  },
})
