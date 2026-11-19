import { createServerFn } from '@tanstack/react-start'

import { getPublicLoginConfig } from '#/server/auth/public-providers'
import { getFreshSession, getSession } from '#/server/auth/guards'
import { getPublicSiteConfig, getSiteSettings } from '#/server/settings'

export const getPublicSiteFn = createServerFn({ method: 'GET' }).handler(
  async () => getPublicSiteConfig(),
)

export const getPublicLoginConfigFn = createServerFn({
  method: 'GET',
}).handler(async () => {
  try {
    return await getPublicLoginConfig()
  } catch {
    return {
      emailPassword: { enabled: false, verificationRequired: false },
      social: [],
      passkey: { enabled: false },
    }
  }
})

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
