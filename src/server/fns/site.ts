import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'

import { db } from '#/db/client'
import { authProvider } from '#/db/schema'
import { getSession } from '#/server/auth/guards'
import { getPublicSiteConfig } from '#/server/settings'

export const getPublicSiteFn = createServerFn({ method: 'GET' }).handler(
  async () => getPublicSiteConfig(),
)

export const getPublicAuthProvidersFn = createServerFn({
  method: 'GET',
}).handler(async () => {
  try {
    const rows = await db
      .select({
        providerId: authProvider.providerId,
        displayName: authProvider.displayName,
      })
      .from(authProvider)
      .where(eq(authProvider.enabled, true))
    return rows
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
