import { createServerFn } from '@tanstack/react-start'

import { getPublicLoginConfig } from '#/server/auth/public-providers'
import { getFreshSession, getSession } from '#/server/auth/guards'
import { createPowChallenge } from '#/server/auth/pow'
import { getPublicSiteConfig, getSiteSettings } from '#/server/settings'

export const getPublicSiteFn = createServerFn({ method: 'GET' }).handler(
  async () => getPublicSiteConfig(),
)

export const getPublicLoginConfigFn = createServerFn({
  method: 'GET',
}).handler(async () => getPublicLoginConfig())

/**
 * 签发一道工作量证明题目；站点关闭人机校验时返回 null。
 * 用 POST：每次都是新题，不能被浏览器或中间层缓存。
 */
export const getPowChallengeFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    const settings = await getSiteSettings()
    if (!settings.captchaEnabled) return null
    return createPowChallenge()
  },
)

export const getSessionFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const settings = await getSiteSettings().catch(() => null)
    // 开启邮箱验证时不能吃 60 秒 cookieCache：验证链接点回来要立刻放行
    const session = await (
      settings?.emailVerificationRequired ? getFreshSession() : getSession()
    ).catch(() => null)
    if (!session?.user) return null
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image ?? null,
      role: (session.user as { role?: string | null }).role ?? 'user',
      emailVerified: Boolean(
        (session.user as { emailVerified?: boolean }).emailVerified,
      ),
      emailVerificationRequired: settings?.emailVerificationRequired ?? false,
      mailboxLimit:
        (session.user as { mailboxLimit?: number | null }).mailboxLimit ?? null,
      sendLimit:
        (session.user as { sendLimit?: number | null }).sendLimit ?? null,
    }
  },
)
