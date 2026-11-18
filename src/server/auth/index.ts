import '#/server/env'

import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { admin } from 'better-auth/plugins'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { eq } from 'drizzle-orm'

import { db } from '#/db/client'
import * as schema from '#/db/schema'
import { decryptSecret } from '#/server/crypto/secret-box'
import {
  getAuthConfigVersion,
  getSiteSettings,
} from '#/server/settings'

export type AuthInstance = ReturnType<typeof betterAuth>

type ProviderRow = typeof schema.authProvider.$inferSelect

async function loadEnabledProviders(): Promise<ProviderRow[]> {
  try {
    return await db
      .select()
      .from(schema.authProvider)
      .where(eq(schema.authProvider.enabled, true))
  } catch {
    // 迁移尚未执行时不阻塞启动
    return []
  }
}

/** 首次启动时把 BOOTSTRAP_ADMIN_EMAIL 对应的账号提权（仅在无管理员时） */
async function promoteBootstrapAdmin(userId?: string, email?: string) {
  const target = process.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase()
  if (!target) return
  if (email && email.toLowerCase() !== target) return

  const existing = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.role, 'admin'))
    .limit(1)
  if (existing.length > 0) return

  await db
    .update(schema.user)
    .set({ role: 'admin' })
    .where(userId ? eq(schema.user.id, userId) : eq(schema.user.email, target))
}

async function buildAuth(): Promise<AuthInstance> {
  const providers = await loadEnabledProviders()
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> =
    {}
  const oauthConfigs: Record<string, unknown>[] = []

  for (const provider of providers) {
    if (!provider.clientId || !provider.clientSecretEnc) continue
    let clientSecret = ''
    try {
      clientSecret = decryptSecret(provider.clientSecretEnc)
    } catch {
      continue
    }

    if (provider.providerId === 'google' || provider.providerId === 'github') {
      socialProviders[provider.providerId] = {
        clientId: provider.clientId,
        clientSecret,
      }
    } else if (provider.providerId === 'oidc' && provider.issuer) {
      oauthConfigs.push({
        providerId: 'oidc',
        clientId: provider.clientId,
        clientSecret,
        discoveryUrl: `${provider.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
        scopes: provider.scopes
          ? provider.scopes.split(/[\s,]+/).filter(Boolean)
          : ['openid', 'email', 'profile'],
        pkce: true,
      })
    }
  }

  const plugins: unknown[] = [
    admin(),
    apiKey({ enableMetadata: true }),
  ]
  if (oauthConfigs.length > 0) {
    plugins.push(genericOAuth({ config: oauthConfigs as never }))
  }
  // 必须放在最后：它要在响应阶段写 cookie
  plugins.push(tanstackStartCookies())

  const options = {
    baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    trustedOrigins: [
      process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
      'http://localhost:3000',
    ],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      autoSignIn: true,
      requireEmailVerification: false,
    },
    account: { encryptOAuthTokens: true },
    user: {
      additionalFields: {
        mailboxLimit: { type: 'number' as const, required: false, input: false },
        sendLimit: { type: 'number' as const, required: false, input: false },
      },
    },
    socialProviders,
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 300 },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (newUser: { email?: string }) => {
            const settings = await getSiteSettings().catch(() => null)
            if (settings && !settings.registrationEnabled) {
              throw new APIError('FORBIDDEN', {
                message: '当前站点已关闭注册，请联系管理员',
              })
            }
            return { data: newUser }
          },
          after: async (newUser: { id: string; email: string }) => {
            try {
              await promoteBootstrapAdmin(newUser.id)
            } catch {
              // 提权失败不影响注册主流程
            }
          },
        },
      },
    },
    plugins,
  }

  return betterAuth(options as never) as unknown as AuthInstance
}

let cache: { version: string; instance: AuthInstance } | null = null
let lastCheckedAt = 0
const VERSION_TTL = 30_000

export async function getAuth(): Promise<AuthInstance> {
  const now = Date.now()
  if (cache && now - lastCheckedAt < VERSION_TTL) return cache.instance

  const version = await getAuthConfigVersion().catch(() => '0')
  lastCheckedAt = now
  if (cache && cache.version === version) return cache.instance

  const instance = await buildAuth()
  cache = { version, instance }
  await promoteBootstrapAdmin().catch(() => undefined)
  return instance
}

export function invalidateAuthCache() {
  lastCheckedAt = 0
  cache = null
}
