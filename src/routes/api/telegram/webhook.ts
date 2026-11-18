import { createFileRoute } from '@tanstack/react-router'

import { safeEqual } from '#/server/crypto/secret-box'
import { getTelegramRuntime } from '#/server/telegram/config'
import { handleTelegramUpdate } from '#/server/telegram/update'
import type { TgUpdate } from '#/server/telegram/api'

/**
 * Telegram Bot Webhook。
 *
 * 安全策略：
 *   - 路径固定（不带 secret），避免 Nginx access log 泄漏；
 *   - 只认 `X-Telegram-Bot-Api-Secret-Token`，常量时间比较；
 *   - 未启用 / 未配 Secret 一律 404，不给探测空间。
 */
export const Route = createFileRoute('/api/telegram/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const runtime = await getTelegramRuntime()
        if (!runtime || !runtime.webhookSecret) {
          return new Response('not found', { status: 404 })
        }

        const provided =
          request.headers.get('x-telegram-bot-api-secret-token') ?? ''
        if (!safeEqual(provided, runtime.webhookSecret)) {
          return new Response('unauthorized', { status: 401 })
        }

        let update: TgUpdate
        try {
          update = (await request.json()) as TgUpdate
        } catch {
          return new Response('bad request', { status: 400 })
        }

        if (typeof update.update_id !== 'number') {
          return new Response('bad request', { status: 400 })
        }

        try {
          await handleTelegramUpdate(update)
          return Response.json({ ok: true })
        } catch (error) {
          // 只有基础设施级错误会走到这里；返回 5xx 让 Telegram 按退避重试
          console.error('[telegram] webhook failed:', error)
          return new Response('internal error', { status: 500 })
        }
      },
    },
  },
})
