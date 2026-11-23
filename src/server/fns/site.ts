import { createServerFn } from '@tanstack/react-start'

import { getPublicLoginConfig } from '#/server/auth/public-providers'
import { getFreshSession } from '#/server/auth/guards'
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
    // 不走 cookieCache:验证/封禁/降权要立刻反映到路由守卫上
    const session = await getFreshSession().catch(() => null)
    if (!session?.user) return null
    if ((session.user as { banned?: boolean | null }).banned) return null
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
