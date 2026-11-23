import '#/server/env'

import { db } from '#/db/client'
import { authProvider } from '#/db/schema'
import { canSendSystemMail } from '#/server/mail/system'
import { isLoginMethodUsable } from '#/server/auth/provider-labels'
import { getSiteSettings } from '#/server/settings'

export type SocialProviderKind = 'google' | 'github' | 'oidc'

export interface PublicSocialProvider {
  providerId: string
  kind: SocialProviderKind
  displayName: string
}

export interface PublicLoginConfig {
  emailPassword: {
    enabled: boolean
    verificationRequired: boolean
    /** 是否已配置可发信的服务商与域名；未配置时验证/重置邮件发不出去 */
    canSend: boolean
  }
  social: PublicSocialProvider[]
  passkey: { enabled: boolean }
}

const SOCIAL_KINDS = new Set<string>(['google', 'github', 'oidc'])

const CACHE_TTL = 60_000

let cache: { value: PublicLoginConfig; at: number } | null = null
let inflight: Promise<PublicLoginConfig> | null = null

/** 登录页展示用的登录方式；管理员保存配置后主动失效 */
export async function getPublicLoginConfig(): Promise<PublicLoginConfig> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.value
  if (inflight) return inflight

  const task = (async () => {
    // 取全部行：停用的邮箱密码方式也要能读到，避免误判为默认开启
    const [rows, settings, canSend] = await Promise.all([
      db.select().from(authProvider),
      getSiteSettings(),
      canSendSystemMail(),
    ])
    const methods = new Map(rows.map((row) => [row.providerId, row]))
    const emailRow = methods.get('email')

    const value: PublicLoginConfig = {
      emailPassword: {
        // 缺行表示管理员删除了邮箱密码方式
        enabled: emailRow ? emailRow.enabled : false,
        verificationRequired: settings.emailVerificationRequired,
        canSend,
      },
      social: rows
        .filter((row) => isLoginMethodUsable(row) && SOCIAL_KINDS.has(row.kind))
        .map((row) => ({
          providerId: row.providerId,
          kind: row.kind as SocialProviderKind,
          displayName: row.displayName,
        })),
      passkey: { enabled: Boolean(methods.get('passkey')?.enabled) },
    }
    cache = { value, at: Date.now() }
    return value
  })()

  inflight = task
  try {
    return await task
  } finally {
    if (inflight === task) inflight = null
  }
}

export function invalidatePublicLoginConfig() {
  cache = null
}
