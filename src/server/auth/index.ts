import '#/server/env'

import { apiKey } from '@better-auth/api-key'
import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { admin } from 'better-auth/plugins'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { eq, sql } from 'drizzle-orm'

import { db } from '#/db/client'
import * as schema from '#/db/schema'
import { decryptSecret } from '#/server/crypto/secret-box'
import { logError } from '#/server/errors'
import { getAuthConfigVersion, getSiteSettings } from '#/server/settings'

import { sendPasswordResetEmail, sendVerificationEmail } from './mailer'
import { powCaptcha } from './pow'

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

/**
 * 站内还没有管理员时，把 BOOTSTRAP_ADMIN_EMAIL 对应的账号提权。
 *
 * 安全约束：
 *   - 只按邮箱精确匹配目标账号，绝不按「刚注册的这个人」提权；
 *   - 站点开启邮箱验证时，目标账号必须已验证，避免抢注同名邮箱冒领管理员；
 *   - 站点配置读取失败时不提权（fail closed），下次实例重建或账号更新时再试。
 */
async function promoteBootstrapAdmin() {
  const target = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase()
  if (!target) return

  const existing = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.role, 'admin'))
    .limit(1)
  if (existing.length > 0) return

  const candidate = (
    await db
      .select({
        id: schema.user.id,
        emailVerified: schema.user.emailVerified,
      })
      .from(schema.user)
      .where(sql`lower(${schema.user.email}) = ${target}`)
      .limit(1)
  ).at(0)
  if (!candidate) return

  const settings = await getSiteSettings().catch(() => null)
  if (!settings) return
  if (settings.emailVerificationRequired && !candidate.emailVerified) return

  await db
    .update(schema.user)
    .set({ role: 'admin' })
    .where(eq(schema.user.id, candidate.id))
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
  // 管理员配置并启用的 IdP 即本站可信来源：既用于用户主动绑定，
  // 也允许登录时按「同邮箱 + 本地已验证」隐式合并到已有账号
  const trustedProviders: string[] = []

  for (const provider of rows) {
    if (!provider.enabled) continue
    if (!provider.clientId || !provider.clientSecretEnc) continue
    let clientSecret = ''
    try {
      clientSecret = decryptSecret(provider.clientSecretEnc)
    } catch {
      continue
    }

    if (provider.kind === 'google' || provider.kind === 'github') {
      // 内置品牌登录的 providerId 必须与品牌一致，避免回调路径漂移
      socialProviders[provider.kind] = {
        clientId: provider.clientId,
        clientSecret,
      }
      trustedProviders.push(provider.kind)
    } else if (provider.kind === 'oidc' && provider.issuer) {
      oauthConfigs.push({
        providerId: provider.providerId,
        clientId: provider.clientId,
        clientSecret,
        discoveryUrl: `${provider.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
        scopes: provider.scopes
          ? provider.scopes.split(/[\s,]+/).filter(Boolean)
          : ['openid', 'email', 'profile'],
        pkce: true,
      })
      trustedProviders.push(provider.providerId)
    }
  }

  const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
  const isDev = process.env.NODE_ENV === 'development'
  const plugins: unknown[] = [
    admin(),
    // 注册 / 密码登录 / 找回密码 / 重发验证邮件前校验工作量证明，开关在站点配置
    powCaptcha(),
    apiKey({
      enableMetadata: true,
      // 插件默认是「每 Key 每天 10 次」；限流参数属于 server-only 字段，客户端创建时不能传
      rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 120 },
    }),
  ]
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
    // localhost 只在开发态信任，生产只认 BETTER_AUTH_URL
    trustedOrigins: isDev ? [baseURL, 'http://localhost:3000'] : [baseURL],
    // 按 IP 限流（依赖反代透传 X-Forwarded-For）；计数存在 rate_limit 表，多实例共享、重启不清零
    rateLimit: {
      enabled: !isDev,
      storage: 'database' as const,
      modelName: 'rateLimit',
      window: 60,
      max: 100,
      customRules: {
        '/sign-up/email': { window: 3600, max: 5 },
        '/sign-in/email': { window: 60, max: 10 },
        '/request-password-reset': { window: 3600, max: 5 },
        '/send-verification-email': { window: 3600, max: 5 },
      },
    },
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
              logError('[asms2] password reset email failed:', error)
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
          logError('[asms2] verification email failed:', error)
        }
      },
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        trustedProviders,
        // 允许绑定邮箱与本站不同的账号（常见于个人 GitHub）：
        // 绑定动作本身要求「已登录 + 完成目标平台授权」，风险可控
        allowDifferentEmails: true,
        // 解绑最后一个账号会把人锁在门外，业务层已拦，这里保持兜底
        allowUnlinkingAll: false,
        // 绑定时不覆盖本地昵称/头像，避免身份信息被 IdP 改写
        updateUserInfoOnLink: false,
      },
    },
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
      // 不做 cookie 级会话缓存:封禁/降权/密码重置必须立即生效。
      // 面板服务端函数每次都走 DB 校验,不用缓存换安全窗口。
      cookieCache: { enabled: false },
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
          after: async () => {
            try {
              await promoteBootstrapAdmin()
            } catch {
              // 提权失败不影响注册主流程
            }
          },
        },
        update: {
          // 开启邮箱验证时，管理员账号要等验证完成才会被提权
          after: async (updated: { emailVerified?: boolean | null }) => {
            if (!updated.emailVerified) return
            try {
              await promoteBootstrapAdmin()
            } catch {
              // 同上
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
