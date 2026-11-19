import '#/server/env'

import { apiKey } from '@better-auth/api-key'
import { passkey } from '@better-auth/passkey'
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
import { getAuthConfigVersion, getSiteSettings } from '#/server/settings'

import { sendPasswordResetEmail, sendVerificationEmail } from './mailer'

export type AuthInstance = ReturnType<typeof betterAuth>

type ProviderRow = typeof schema.authProvider.$inferSelect

async function loadAuthProviders(): Promise<ProviderRow[]> {
  try {
    return await db.select().from(schema.authProvider)
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
  const [rows, settings] = await Promise.all([
    loadAuthProviders(),
    getSiteSettings().catch(() => null),
  ])
  const methods = new Map(rows.map((row) => [row.providerId, row]))
  const emailRow = methods.get('email')
  // 缺行 = 管理员删除了邮箱密码方式；默认行由迁移写入
  const emailEnabled = emailRow ? emailRow.enabled : false
  const passkeyEnabled = Boolean(methods.get('passkey')?.enabled)
  const socialProviders: Record<
    string,
    { clientId: string; clientSecret: string }
  > = {}
  const oauthConfigs: Record<string, unknown>[] = []

  for (const provider of rows) {
    if (!provider.enabled) continue
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

  const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
  const plugins: unknown[] = [admin(), apiKey({ enableMetadata: true })]
  if (oauthConfigs.length > 0) {
    plugins.push(genericOAuth({ config: oauthConfigs as never }))
  }
  if (passkeyEnabled) {
    const url = new URL(baseURL)
    plugins.push(
      passkey({
        rpID: url.hostname,
        rpName: settings?.siteName ?? 'asms2',
        origin: url.origin,
      }),
    )
  }
  // 必须放在最后：它要在响应阶段写 cookie
  plugins.push(tanstackStartCookies())

  const options = {
    baseURL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    trustedOrigins: [baseURL, 'http://localhost:3000'],
    emailAndPassword: {
      enabled: emailEnabled,
      minPasswordLength: 8,
      autoSignIn: true,
      requireEmailVerification: false,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      // 未启用邮箱密码登录时不注册发送器，重置接口会直接返回禁用
      sendResetPassword: emailEnabled
        ? async ({ user, url }: { user: { email: string }; url: string }) => {
            const current = await getSiteSettings()
            try {
              await sendPasswordResetEmail({
                siteName: current.siteName,
                to: user.email,
                url,
              })
            } catch (error) {
              // 发信失败不能把账号是否存在暴露给请求方，只记录日志
              console.error('[asms2] password reset email failed:', error)
            }
          }
        : undefined,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({
        user,
        url,
      }: {
        user: { email: string }
        url: string
      }) => {
        const current = await getSiteSettings()
        // 开关在请求时读取：管理员关闭后无需重建实例也会停止发信
        if (!current.emailVerificationRequired) return
        try {
          await sendVerificationEmail({
            siteName: current.siteName,
            to: user.email,
            url,
          })
        } catch (error) {
          // 发信失败不能阻断注册；用户可以稍后在验证页重新发送
          console.error('[asms2] verification email failed:', error)
        }
      },
    },
    account: { encryptOAuthTokens: true },
    user: {
      additionalFields: {
        mailboxLimit: {
          type: 'number' as const,
          required: false,
          input: false,
        },
        sendLimit: { type: 'number' as const, required: false, input: false },
      },
    },
    socialProviders,
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // 缓存仍能挡掉绝大多数会话查询，同时把封禁/降权的最坏延迟压到 1 分钟
      cookieCache: { enabled: true, maxAge: 60 },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (newUser: { email?: string }) => {
            const current = await getSiteSettings().catch(() => null)
            if (current && !current.registrationEnabled) {
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
let resolving: Promise<AuthInstance> | null = null
const VERSION_TTL = 30_000

async function resolveAuth(): Promise<AuthInstance> {
  const now = Date.now()
  const version = await getAuthConfigVersion().catch(() => '0')
  lastCheckedAt = now
  if (cache && cache.version === version) return cache.instance

  const instance = await buildAuth()
  cache = { version, instance }
  await promoteBootstrapAdmin().catch(() => undefined)
  return instance
}

export async function getAuth(): Promise<AuthInstance> {
  const now = Date.now()
  if (cache && now - lastCheckedAt < VERSION_TTL) return cache.instance
  if (resolving) return resolving

  const task = resolveAuth()
  resolving = task
  try {
    return await task
  } finally {
    if (resolving === task) resolving = null
  }
}

export function invalidateAuthCache() {
  lastCheckedAt = 0
  cache = null
  resolving = null
}
