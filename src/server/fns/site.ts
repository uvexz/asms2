import { createServerFn } from '@tanstack/react-start'

import { listPublicAuthProviders } from '#/server/auth/public-providers'
import { getSession } from '#/server/auth/guards'
import { getPublicSiteConfig } from '#/server/settings'

export const getPublicSiteFn = createServerFn({ method: 'GET' }).handler(
  async () => getPublicSiteConfig(),
)

export const getPublicAuthProvidersFn = createServerFn({
  method: 'GET',
}).handler(async () => {
  try {
    return await listPublicAuthProviders()
  } catch {
    return []
  }
})

export const getSessionFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await getSession().catch(() => null)
    if (!session?.user) return null
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image ?? null,
      role: (session.user as { role?: string | null }).role ?? 'user',
      mailboxLimit:
        (session.user as { mailboxLimit?: number | null }).mailboxLimit ?? null,
      sendLimit:
        (session.user as { sendLimit?: number | null }).sendLimit ?? null,
    }
  },
)
