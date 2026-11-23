import '#/server/env'

import { eq } from 'drizzle-orm'

import { db } from '#/db/client'
import { appMeta, siteSettings } from '#/db/schema'
import { AppError } from '#/server/errors'

export type SiteSettings = typeof siteSettings.$inferSelect

const CACHE_TTL = 10_000

let cache: { value: SiteSettings; at: number } | null = null
let inflight: Promise<SiteSettings> | null = null

async function loadSiteSettings(): Promise<SiteSettings> {
  let row = (
    await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.id, 'default'))
      .limit(1)
  ).at(0)

  if (!row) {
    await db
      .insert(siteSettings)
      .values({ id: 'default' })
      .onConflictDoNothing()
    row = (
      await db
        .select()
        .from(siteSettings)
        .where(eq(siteSettings.id, 'default'))
        .limit(1)
    ).at(0)
  }

  // 建表/并发异常时这里仍可能读不到；显式失败好过把 undefined 当配置往下传。
  if (!row) {
    throw new AppError('internal', '站点配置初始化失败', 500)
  }
  return row
}

/** 单行站点配置；不存在时惰性建默认行，避免额外的 seed 步骤 */
export async function getSiteSettings(force = false): Promise<SiteSettings> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL) {
    return cache.value
  }
  if (!force && inflight) return inflight

  const task = loadSiteSettings()
  inflight = task
  try {
    const row = await task
    cache = { value: row, at: Date.now() }
    return row
  } finally {
    if (inflight === task) inflight = null
  }
}

/**
 * 站点开启「必须验证邮箱」时，未验证账号不得使用收发、API Key、Telegram 等业务能力。
 * 这里只看数据库里的 emailVerified 与站点开关，不依赖请求上下文，
 * 供 API Key 鉴权、Telegram 机器人等非浏览器入口复用。
 */
export async function isEmailVerificationSatisfied(
  emailVerified: boolean | null | undefined,
): Promise<boolean> {
  if (emailVerified) return true
  const settings = await getSiteSettings()
  return !settings.emailVerificationRequired
}

/** 对外公开的站点信息，绝不包含密钥类字段 */
export async function getPublicSiteConfig() {
  const s = await getSiteSettings()
  return {
    siteName: s.siteName,
    siteDescription: s.siteDescription,
    logoUrl: s.logoUrl,
    faviconUrl: s.faviconUrl,
    contactEmail: s.contactEmail,
    footerText: s.footerText,
    registrationEnabled: s.registrationEnabled,
    permanentPrefixMin: s.permanentPrefixMin,
    tempPrefixMin: s.tempPrefixMin,
    prefixMax: s.prefixMax,
    allowTempSend: s.allowTempSend,
    allowUserDomainChoice: s.allowUserDomainChoice,
    tempTtlMinutes: s.tempTtlMinutes,
    trashRetentionDays: s.trashRetentionDays,
    orphanRetentionDays: s.orphanRetentionDays,
    deletedMailboxRetentionDays: s.deletedMailboxRetentionDays,
  }
}

export async function getMeta(key: string): Promise<string | null> {
  const row = (
    await db.select().from(appMeta).where(eq(appMeta.key, key)).limit(1)
  ).at(0)
  return row?.value ?? null
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db
    .insert(appMeta)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appMeta.key,
      set: { value, updatedAt: new Date() },
    })
}

/** 第三方登录配置变更后自增，getAuth 检测到变化会重建实例 */
export async function bumpAuthConfigVersion(): Promise<void> {
  await setMeta('auth_config_version', String(Date.now()))
}

export async function getAuthConfigVersion(): Promise<string> {
  return (await getMeta('auth_config_version')) ?? '0'
}
