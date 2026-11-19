import '#/server/env'

import { eq } from 'drizzle-orm'

import { db } from '#/db/client'
import { authProvider } from '#/db/schema'

export interface PublicAuthProvider {
  providerId: string
  displayName: string
}

const CACHE_TTL = 60_000

let cache: { value: PublicAuthProvider[]; at: number } | null = null
let inflight: Promise<PublicAuthProvider[]> | null = null

/** 登录页展示用的第三方登录列表；管理员保存配置后主动失效 */
export async function listPublicAuthProviders(): Promise<PublicAuthProvider[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.value
  if (inflight) return inflight

  const task = (async () => {
    const rows = await db
      .select({
        providerId: authProvider.providerId,
        displayName: authProvider.displayName,
      })
      .from(authProvider)
      .where(eq(authProvider.enabled, true))
    cache = { value: rows, at: Date.now() }
    return rows
  })()

  inflight = task
  try {
    return await task
  } finally {
    if (inflight === task) inflight = null
  }
}

export function invalidatePublicAuthProviders() {
  cache = null
}
