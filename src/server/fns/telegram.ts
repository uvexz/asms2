import { randomBytes } from 'node:crypto'

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { customAlphabet } from 'nanoid'

import { db } from '#/db/client'
import { auditLog } from '#/db/schema'
import {
  clientIp,
  requireAdmin,
  requireUser,
  userAgent,
} from '#/server/auth/guards'
import { encryptSecret, last4, decryptSecret } from '#/server/crypto/secret-box'
import { AppError, attempt } from '#/server/errors'
import { getSiteSettings } from '#/server/settings'
import {
  getMe,
  sendMessage,
  setWebhook,
  deleteWebhook,
} from '#/server/telegram/api'
import {
  getTelegramBotRow,
  getTelegramRuntime,
  recordTelegramError,
  saveTelegramBot,
} from '#/server/telegram/config'
import type { TelegramBotPatch } from '#/server/telegram/config'
import {
  createBindCode,
  listLinks,
  MAX_LINKS_PER_USER,
  unbindLink,
  updateLinkNotify,
} from '#/server/telegram/link'

const idPart = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 20)

async function auditTelegram(actorId: string, action: string, meta?: unknown) {
  await db.insert(auditLog).values({
    id: idPart(),
    actorUserId: actorId,
    actorRole: 'admin',
    action,
    targetType: 'telegram',
    targetId: 'default',
    metaJson: meta ? JSON.stringify(meta).slice(0, 5000) : null,
    ip: clientIp(),
    userAgent: userAgent(),
    createdAt: new Date(),
  })
}

function siteBaseUrl(siteUrl: string | null): string {
  return (siteUrl ?? process.env.BETTER_AUTH_URL ?? '').replace(/\/$/, '')
}

/* ------------------------------------------------------------------- user */

export const telegramStatusFn = createServerFn({ method: 'GET' }).handler(
  async () =>
    attempt(async () => {
      const user = await requireUser()
      const runtime = await getTelegramRuntime()
      const rows = await listLinks(user.id)

      return {
        enabled: Boolean(runtime),
        botUsername: runtime?.botUsername ?? null,
        maxLinks: MAX_LINKS_PER_USER,
        links: rows.map((row) => ({
          id: row.id,
          chatLabel: row.tgUsername
            ? `@${row.tgUsername}`
            : row.tgFirstName || `chat …${row.chatId.slice(-4)}`,
          notifyEnabled: row.notifyEnabled,
          notifyScope: row.notifyScope,
          linkedAt: row.linkedAt.getTime(),
          lastNotifiedAt: row.lastNotifiedAt?.getTime() ?? null,
        })),
      }
    }),
)

export const createTelegramBindCodeFn = createServerFn({
  method: 'POST',
}).handler(async () =>
  attempt(async () => {
    const user = await requireUser()
    const runtime = await getTelegramRuntime()
    if (!runtime) {
      throw new AppError(
        'not_implemented',
        '管理员尚未启用 Telegram 机器人',
        503,
      )
    }

    const { code, expiresAt } = await createBindCode(user.id)
    return {
      code,
      expiresAt: expiresAt.getTime(),
      deepLink: runtime.botUsername
        ? `https://t.me/${runtime.botUsername}?start=${code}`
        : null,
    }
  }),
)

export const unbindTelegramFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => z.object({ linkId: z.string() }).parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const user = await requireUser()
      const removed = await unbindLink(user.id, data.linkId)
      if (!removed) throw new AppError('not_found', '绑定不存在', 404)
      return { id: data.linkId }
    }),
  )

export const updateTelegramNotifyFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z
      .object({
        linkId: z.string(),
        notifyEnabled: z.boolean().optional(),
        notifyScope: z.enum(['all', 'temp', 'permanent']).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      const user = await requireUser()
      const { linkId, ...patch } = data
      const row = await updateLinkNotify(user.id, linkId, patch)
      if (!row) throw new AppError('not_found', '绑定不存在', 404)
      return {
        id: row.id,
        notifyEnabled: row.notifyEnabled,
        notifyScope: row.notifyScope,
      }
    }),
  )

/* ------------------------------------------------------------------ admin */

export interface AdminTelegramView {
  enabled: boolean
  hasToken: boolean
  tokenLast4: string | null
  botId: string | null
  botUsername: string | null
  hasSecret: boolean
  webhookSecretLast4: string | null
  webhookUrl: string | null
  webhookSetAt: number | null
  webhookPath: string
  expectedUrl: string | null
  lastError: string | null
  lastErrorAt: number | null
  maxLinksPerUser: number
}

async function adminTelegramView(): Promise<AdminTelegramView> {
  const [row, settings] = await Promise.all([
    getTelegramBotRow(true),
    getSiteSettings(true),
  ])
  const base = siteBaseUrl(settings.siteUrl)

  return {
    enabled: Boolean(row?.enabled),
    hasToken: Boolean(row?.botTokenEnc),
    tokenLast4: row?.botTokenLast4 ?? null,
    botId: row?.botId ?? null,
    botUsername: row?.botUsername ?? null,
    hasSecret: Boolean(row?.webhookSecretEnc),
    webhookSecretLast4: row?.webhookSecretLast4 ?? null,
    webhookUrl: row?.webhookUrl ?? null,
    webhookSetAt: row?.webhookSetAt?.getTime() ?? null,
    webhookPath: '/api/telegram/webhook',
    expectedUrl: base ? `${base}/api/telegram/webhook` : null,
    lastError: row?.lastError ?? null,
    lastErrorAt: row?.lastErrorAt?.getTime() ?? null,
    maxLinksPerUser: MAX_LINKS_PER_USER,
  }
}

export const adminGetTelegramFn = createServerFn({ method: 'GET' }).handler(
  async () =>
    attempt(async () => {
      await requireAdmin()
      return adminTelegramView()
    }),
)

export const adminSaveTelegramFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        botToken: z.string().trim().min(20).max(200).optional(),
        regenerateSecret: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      const existing = await getTelegramBotRow(true)

      if (data.enabled && !data.botToken && !existing?.botTokenEnc) {
        throw new AppError('validation_failed', '启用前请先填写 Bot Token')
      }

      const patch: TelegramBotPatch = { enabled: data.enabled }

      if (data.botToken) {
        let me: Awaited<ReturnType<typeof getMe>>
        try {
          me = await getMe(data.botToken)
        } catch (error) {
          throw new AppError(
            'validation_failed',
            `Bot Token 校验失败：${error instanceof Error ? error.message : '请检查 Token 是否正确'}`,
            400,
          )
        }
        patch.botTokenEnc = encryptSecret(data.botToken)
        patch.botTokenLast4 = last4(data.botToken)
        patch.botId = String(me.id)
        patch.botUsername = me.username ?? null
        // 换了机器人 → 旧机器人的 Webhook 不再适用，清掉登记让管理员重新注册
        if (existing?.botId && existing.botId !== String(me.id)) {
          patch.webhookUrl = null
          patch.webhookSetAt = null
        }
      }

      if (!existing?.webhookSecretEnc || data.regenerateSecret) {
        const secret = randomBytes(32).toString('hex')
        patch.webhookSecretEnc = encryptSecret(secret)
        patch.webhookSecretLast4 = last4(secret)
        // Secret 变了，之前的 Webhook 必须重新注册
        patch.webhookUrl = null
        patch.webhookSetAt = null
      }

      if (data.enabled) {
        patch.lastError = null
        patch.lastErrorAt = null
      } else if (existing?.botTokenEnc) {
        // 停用时顺手把 Telegram 侧的 Webhook 摘掉，避免它持续重推 404
        try {
          await deleteWebhook(decryptSecret(existing.botTokenEnc))
        } catch {
          // 网络失败不影响停用本身
        }
        patch.webhookUrl = null
        patch.webhookSetAt = null
      }

      await saveTelegramBot(patch, actor.id)
      await auditTelegram(actor.id, 'telegram.update', {
        enabled: data.enabled,
        tokenChanged: Boolean(data.botToken),
        secretRegenerated: Boolean(data.regenerateSecret),
      })

      return adminTelegramView()
    }),
  )

export const adminRegisterTelegramWebhookFn = createServerFn({
  method: 'POST',
}).handler(async () =>
  attempt(async () => {
    const actor = await requireAdmin()
    const runtime = await getTelegramRuntime()
    if (!runtime) {
      throw new AppError(
        'validation_failed',
        '请先保存并启用 Bot Token，再注册 Webhook',
      )
    }
    if (!runtime.webhookSecret) {
      throw new AppError(
        'validation_failed',
        'Webhook Secret 缺失，请保存配置时重新生成',
      )
    }

    const settings = await getSiteSettings(true)
    const base = siteBaseUrl(settings.siteUrl)
    if (!base) {
      throw new AppError(
        'validation_failed',
        '请先在「站点信息」填写站点地址（siteUrl），用于拼 Webhook URL',
      )
    }

    const url = `${base}/api/telegram/webhook`
    try {
      await setWebhook(runtime.token, {
        url,
        secretToken: runtime.webhookSecret,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Telegram 拒绝注册'
      await recordTelegramError(`注册 Webhook 失败：${message}`)
      throw new AppError('provider_error', `注册失败：${message}`, 502)
    }

    await saveTelegramBot(
      { webhookUrl: url, webhookSetAt: new Date() },
      actor.id,
    )
    await auditTelegram(actor.id, 'telegram.webhook.register', { url })
    return { url }
  }),
)

export const adminDeleteTelegramWebhookFn = createServerFn({
  method: 'POST',
}).handler(async () =>
  attempt(async () => {
    const actor = await requireAdmin()
    const runtime = await getTelegramRuntime()
    if (!runtime) {
      throw new AppError('validation_failed', 'Bot 未启用')
    }

    try {
      await deleteWebhook(runtime.token)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Telegram 取消失败'
      throw new AppError('provider_error', `取消失败：${message}`, 502)
    }

    await saveTelegramBot({ webhookUrl: null, webhookSetAt: null }, actor.id)
    await auditTelegram(actor.id, 'telegram.webhook.delete')
    return { ok: true }
  }),
)

export const adminTestTelegramFn = createServerFn({ method: 'POST' }).handler(
  async () =>
    attempt(async () => {
      const actor = await requireAdmin()
      const runtime = await getTelegramRuntime()
      if (!runtime) {
        throw new AppError('validation_failed', 'Bot 未启用')
      }

      const links = await listLinks(actor.id)
      if (links.length === 0) {
        throw new AppError(
          'validation_failed',
          '当前管理员账号还没有绑定 Telegram，请先在「个人设置」生成绑定码并用 /bind 绑定',
        )
      }

      const settings = await getSiteSettings(true)
      let sent = 0
      for (const link of links) {
        try {
          await sendMessage(runtime.token, {
            chatId: link.chatId,
            text: [
              '<b>asms2 测试消息</b>',
              `站点：${settings.siteName}`,
              '如果你收到这条消息，说明 Bot Token 与推送通道正常。',
            ].join('\n'),
          })
          sent += 1
        } catch (error) {
          await recordTelegramError(
            error instanceof Error ? error.message : '测试消息发送失败',
          )
        }
      }

      if (sent === 0) {
        throw new AppError(
          'provider_error',
          '测试消息一条都没发出去，请检查 Token',
          502,
        )
      }
      return { sent }
    }),
)
