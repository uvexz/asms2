import { createServerFn } from '@tanstack/react-start'
import { desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'
import { z } from 'zod'

import { db } from '#/db/client'
import {
  account,
  auditLog,
  authProvider,
  domain,
  mailbox,
  message,
  passkey,
  providerConfig,
  session,
  siteSettings,
  unroutedMessage,
  user,
  webhookEndpoint,
  webhookEvent,
} from '#/db/schema'
import { clientIp, requireAdmin, userAgent } from '#/server/auth/guards'
import { accountKind, accountLabel } from '#/server/auth/provider-labels'
import type { LoginAccountKind } from '#/server/auth/provider-labels'
import { invalidateAuthCache } from '#/server/auth'
import { invalidatePublicLoginConfig } from '#/server/auth/public-providers'
import { exemptExistingUsersFromVerification } from '#/server/auth/verification'
import { encryptSecret, last4 } from '#/server/crypto/secret-box'
import { AppError, attempt } from '#/server/errors'
import { getProviderById } from '#/server/mail/provider-config'
import { canSendSystemMail } from '#/server/mail/system'
import { normalizeApiBaseUrl } from '#/server/mail/provider-url'
import { getProvider } from '#/server/providers'
import type { DnsRecord } from '#/server/providers'
import { bumpAuthConfigVersion, getSiteSettings } from '#/server/settings'
import { containsInsensitive } from '#/server/sql'
import { isValidTimeZone } from '#/lib/timezone'

const idPart = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 20)

async function audit(
  actorId: string,
  action: string,
  targetType?: string,
  targetId?: string,
  meta?: unknown,
) {
  await db.insert(auditLog).values({
    id: idPart(),
    actorUserId: actorId,
    actorRole: 'admin',
    action,
    targetType,
    targetId,
    metaJson: meta ? JSON.stringify(meta).slice(0, 5000) : null,
    ip: clientIp(),
    userAgent: userAgent(),
    createdAt: new Date(),
  })
}

/* ---------------------------------------------------------------- overview */

export const adminOverviewFn = createServerFn({ method: 'GET' }).handler(
  async () =>
    attempt(async () => {
      await requireAdmin()
      const [users, boxes, mails, sends] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(user),
        db
          .select({ count: sql<number>`count(*)` })
          .from(mailbox)
          .where(ne(mailbox.status, 'deleted')),
        db.select({ count: sql<number>`count(*)` }).from(message),
        db
          .select({ count: sql<number>`count(*)` })
          .from(message)
          .where(eq(message.direction, 'outbound')),
      ])
      const failedHooks = await db
        .select({ count: sql<number>`count(*)` })
        .from(webhookEvent)
        .where(eq(webhookEvent.status, 'failed'))

      return {
        users: Number(users[0]?.count ?? 0),
        mailboxes: Number(boxes[0]?.count ?? 0),
        messages: Number(mails[0]?.count ?? 0),
        outbound: Number(sends[0]?.count ?? 0),
        failedWebhooks: Number(failedHooks[0]?.count ?? 0),
      }
    }),
)

/* -------------------------------------------------------------------- site */

export const adminGetSettingsFn = createServerFn({ method: 'GET' }).handler(
  async () =>
    attempt(async () => {
      await requireAdmin()
      return getSiteSettings(true)
    }),
)

const settingsPatchSchema = z.object({
  siteName: z.string().min(1).max(60).optional(),
  siteDescription: z.string().max(200).optional(),
  logoUrl: z.string().max(500).nullable().optional(),
  faviconUrl: z.string().max(500).nullable().optional(),
  siteUrl: z.string().max(200).nullable().optional(),
  contactEmail: z.string().max(200).nullable().optional(),
  icpRecord: z.string().max(200).nullable().optional(),
  footerText: z.string().max(200).nullable().optional(),
  registrationEnabled: z.boolean().optional(),
  captchaEnabled: z.boolean().optional(),
  newAccountSendCooldownHours: z.number().int().min(0).max(720).optional(),
  defaultMailboxLimit: z.number().int().min(0).max(100).optional(),
  defaultDailySendLimit: z.number().int().min(0).max(1000).optional(),
  permanentPrefixMin: z.number().int().min(1).max(32).optional(),
  tempPrefixMin: z.number().int().min(4).max(32).optional(),
  prefixMax: z.number().int().min(4).max(64).optional(),
  tempTtlMinutes: z.number().int().min(5).max(10080).optional(),
  tempGraceMinutes: z.number().int().min(0).max(10080).optional(),
  tempCooldownHours: z.number().int().min(0).max(720).optional(),
  permanentCooldownDays: z.number().int().min(0).max(365).optional(),
  allowTempSend: z.boolean().optional(),
  allowUserDomainChoice: z.boolean().optional(),
  trashRetentionDays: z.number().int().min(1).max(365).optional(),
  orphanRetentionDays: z.number().int().min(1).max(365).optional(),
  deletedMailboxRetentionDays: z.number().int().min(0).max(3650).optional(),
  // 非法时区会让 usageDateFor 抛 RangeError，进而打挂发件/配额/收件
  timezone: z
    .string()
    .max(60)
    .refine(
      (value) => isValidTimeZone(value),
      '时区不合法，请填写 IANA 时区（如 Asia/Shanghai）',
    )
    .optional(),
})

export const adminUpdateSettingsFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => settingsPatchSchema.parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      await getSiteSettings()
      await db
        .update(siteSettings)
        .set({ ...data, updatedAt: new Date(), updatedBy: actor.id })
        .where(eq(siteSettings.id, 'default'))
      // 站点配置参与登录页展示（邮箱验证开关），同步失效公开登录配置缓存
      invalidatePublicLoginConfig()
      await audit(actor.id, 'site.update', 'site', 'default', data)
      return getSiteSettings(true)
    }),
  )

/* ----------------------------------------------------------------- domains */

export const adminListDomainsFn = createServerFn({ method: 'GET' }).handler(
  async () =>
    attempt(async () => {
      await requireAdmin()
      const rows = await db
        .select({
          domain: domain,
          providerLabel: providerConfig.label,
          providerKind: providerConfig.kind,
        })
        .from(domain)
        .leftJoin(
          providerConfig,
          eq(providerConfig.id, domain.providerConfigId),
        )
        .orderBy(desc(domain.createdAt))
      return rows.map((row) => ({
        ...row.domain,
        providerLabel: row.providerLabel ?? '',
        providerKind: row.providerKind ?? 'resend',
      }))
    }),
)

const createDomainSchema = z.object({
  hostname: z
    .string()
    .min(3)
    .max(200)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, '域名格式不正确'),
  providerConfigId: z.string(),
  allowPermanentCreate: z.boolean().default(true),
  allowTempCreate: z.boolean().default(true),
})

export const adminCreateDomainFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => createDomainSchema.parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      const hostname = data.hostname.toLowerCase()
      const exists = await db
        .select({ id: domain.id })
        .from(domain)
        .where(eq(domain.hostname, hostname))
        .limit(1)
      if (exists.length > 0) {
        throw new AppError('conflict', '该域名已存在', 409)
      }

      const resolved = await getProviderById(data.providerConfigId)
      if (!resolved.provider.createDomain) {
        throw new AppError(
          'not_implemented',
          `${resolved.config.label} 不支持自动创建域名`,
          501,
        )
      }

      const created = await resolved.provider.createDomain(
        hostname,
        resolved.runtime,
      )

      await db.insert(domain).values({
        id: idPart(),
        hostname,
        providerConfigId: data.providerConfigId,
        providerDomainId: created.providerDomainId,
        allowPermanentCreate: data.allowPermanentCreate,
        allowTempCreate: data.allowTempCreate,
        status: created.status as 'pending' | 'verified' | 'failed',
        dnsRecordsJson: JSON.stringify(created.records),
        lastCheckedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      await audit(actor.id, 'domain.create', 'domain', hostname)
      return { hostname }
    }),
  )

export const adminVerifyDomainFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      const row = (
        await db.select().from(domain).where(eq(domain.id, data.id)).limit(1)
      ).at(0)
      if (!row) throw new AppError('not_found', '域名不存在', 404)

      const resolved = await getProviderById(row.providerConfigId)
      if (!row.providerDomainId || !resolved.provider.verifyDomain) {
        throw new AppError('not_implemented', '该服务商不支持域名验证', 501)
      }

      await resolved.provider.verifyDomain(
        row.providerDomainId,
        resolved.runtime,
      )
      const status = await resolved.provider.getDomain?.(
        row.providerDomainId,
        resolved.runtime,
      )

      await db
        .update(domain)
        .set({
          status: (status?.status ?? 'pending') as
            'pending' | 'verified' | 'failed',
          dnsRecordsJson: status?.records
            ? JSON.stringify(status.records)
            : row.dnsRecordsJson,
          lastCheckedAt: new Date(),
          verifiedAt:
            status?.status === 'verified' ? new Date() : row.verifiedAt,
          updatedAt: new Date(),
        })
        .where(eq(domain.id, row.id))

      await audit(actor.id, 'domain.verify', 'domain', row.hostname)
      return { status: status?.status ?? 'pending' }
    }),
  )

export const adminUpdateDomainFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z
      .object({
        id: z.string(),
        allowPermanentCreate: z.boolean().optional(),
        allowTempCreate: z.boolean().optional(),
        receivingEnabled: z.boolean().optional(),
        sendingEnabled: z.boolean().optional(),
        isDefaultPermanent: z.boolean().optional(),
        isDefaultTemp: z.boolean().optional(),
        status: z
          .enum(['pending', 'verified', 'failed', 'disabled'])
          .optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      const { id, ...patch } = data
      await db
        .update(domain)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(domain.id, id))
      await audit(actor.id, 'domain.update', 'domain', id, patch)
      return { id }
    }),
  )

export const adminDeleteDomainFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      const used = await db
        .select({ count: sql<number>`count(*)` })
        .from(mailbox)
        .where(eq(mailbox.domainId, data.id))
      if (Number(used[0]?.count ?? 0) > 0) {
        throw new AppError('conflict', '该域名下仍有邮箱，不能删除', 409)
      }
      await db.delete(domain).where(eq(domain.id, data.id))
      await audit(actor.id, 'domain.delete', 'domain', data.id)
      return { id: data.id }
    }),
  )

export const adminDiscoverProviderDomainsFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z.object({ providerConfigId: z.string() }).parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      await requireAdmin()
      const resolved = await getProviderById(data.providerConfigId)
      if (!resolved.provider.listDomains) {
        throw new AppError(
          'not_implemented',
          `${resolved.config.label} 不支持读取账号域名列表`,
          501,
        )
      }

      const discovered = await resolved.provider.listDomains(resolved.runtime)
      const existing = await db
        .select({ hostname: domain.hostname })
        .from(domain)
      const taken = new Set(existing.map((row) => row.hostname))
      const seen = new Set<string>()
      const candidates: {
        providerDomainId: string
        hostname: string
        status: string
      }[] = []

      for (const item of discovered) {
        const hostname = item.hostname.trim().toLowerCase()
        if (!hostname || taken.has(hostname) || seen.has(hostname)) continue
        seen.add(hostname)
        candidates.push({
          providerDomainId: item.providerDomainId,
          hostname,
          status: item.status,
        })
      }

      return {
        providerLabel: resolved.config.label,
        domains: candidates,
      }
    }),
  )

export const adminImportProviderDomainsFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z
      .object({
        providerConfigId: z.string(),
        providerDomainIds: z.array(z.string()).min(1).max(100),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      const resolved = await getProviderById(data.providerConfigId)
      if (!resolved.provider.listDomains) {
        throw new AppError(
          'not_implemented',
          `${resolved.config.label} 不支持读取账号域名列表`,
          501,
        )
      }

      // 不信任前端传来的域名：以服务商返回的列表为准重新核对一遍
      const discovered = await resolved.provider.listDomains(resolved.runtime)
      const byId = new Map(
        discovered.map((item) => [item.providerDomainId, item]),
      )

      const existing = await db
        .select({ hostname: domain.hostname })
        .from(domain)
      const taken = new Set(existing.map((row) => row.hostname))
      const details: {
        providerDomainId: string
        hostname: string
        status: 'pending' | 'verified' | 'failed' | 'disabled'
        records: DnsRecord[]
      }[] = []

      for (const id of new Set(data.providerDomainIds)) {
        const item = byId.get(id)
        if (!item) continue
        const hostname = item.hostname.trim().toLowerCase()
        if (!hostname || taken.has(hostname)) continue
        taken.add(hostname)

        const detail = resolved.provider.getDomain
          ? await resolved.provider.getDomain(id, resolved.runtime)
          : null
        const status = detail?.status ?? item.status
        details.push({
          providerDomainId: id,
          hostname,
          status: ['pending', 'verified', 'failed', 'disabled'].includes(status)
            ? (status as 'pending' | 'verified' | 'failed' | 'disabled')
            : 'pending',
          records: detail?.records ?? [],
        })
      }

      if (details.length === 0) {
        throw new AppError(
          'validation_failed',
          '所选域名已被添加，或已不在服务商账号中',
          400,
        )
      }

      const now = new Date()
      await db.insert(domain).values(
        details.map((item) => ({
          id: idPart(),
          hostname: item.hostname,
          providerConfigId: data.providerConfigId,
          providerDomainId: item.providerDomainId,
          allowPermanentCreate: true,
          allowTempCreate: true,
          status: item.status,
          dnsRecordsJson:
            item.records.length > 0 ? JSON.stringify(item.records) : null,
          lastCheckedAt: now,
          verifiedAt: item.status === 'verified' ? now : null,
          createdAt: now,
          updatedAt: now,
        })),
      )

      await audit(
        actor.id,
        'domain.import',
        'provider',
        data.providerConfigId,
        {
          hostnames: details.map((item) => item.hostname),
        },
      )
      return {
        imported: details.length,
        hostnames: details.map((item) => item.hostname),
      }
    }),
  )

/* --------------------------------------------------------------- providers */

export const adminListProvidersFn = createServerFn({ method: 'GET' }).handler(
  async () =>
    attempt(async () => {
      await requireAdmin()
      const rows = await db
        .select()
        .from(providerConfig)
        .orderBy(desc(providerConfig.createdAt))
      return rows.map((row) => ({
        ...row,
        apiKeyEnc: undefined,
        capabilitiesJson: undefined,
        // 能力以适配器为准，capabilitiesJson 仅作为历史快照保留
        capabilities: getProvider(row.kind).capabilities,
      }))
    }),
)

const providerSchema = z.object({
  kind: z.enum([
    'resend',
    'unitpost',
    'ahasend',
    'groundmail',
    'mailtrap',
    'plunk',
    'reloop',
    'custom',
  ]),
  label: z.string().min(1).max(60),
  apiKey: z.string().min(8).optional(),
  apiBaseUrl: z.string().max(300).nullable().optional(),
  /** AhaSend 的账号 UUID；其它服务商留空 */
  accountId: z.string().max(100).nullable().optional(),
  isDefaultForSend: z.boolean().optional(),
})

export const adminCreateProviderFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => providerSchema.parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      if (!data.apiKey)
        throw new AppError('validation_failed', '请填写 API Key')

      if (data.isDefaultForSend) {
        await db.update(providerConfig).set({ isDefaultForSend: false })
      }

      const id = idPart()
      await db.insert(providerConfig).values({
        id,
        kind: data.kind,
        label: data.label,
        apiKeyEnc: encryptSecret(data.apiKey),
        apiKeyLast4: last4(data.apiKey),
        apiBaseUrl: normalizeApiBaseUrl(data.apiBaseUrl) ?? null,
        externalAccountId: data.accountId?.trim() || null,
        capabilitiesJson: JSON.stringify(getProvider(data.kind).capabilities),
        isDefaultForSend: data.isDefaultForSend ?? false,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: actor.id,
      })
      await audit(actor.id, 'provider.create', 'provider', id, {
        kind: data.kind,
        label: data.label,
      })
      return { id }
    }),
  )

export const adminUpdateProviderFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z
      .object({
        id: z.string(),
        label: z.string().min(1).max(60).optional(),
        apiKey: z.string().min(8).optional(),
        apiBaseUrl: z.string().max(300).nullable().optional(),
        accountId: z.string().max(100).nullable().optional(),
        status: z.enum(['active', 'invalid', 'disabled']).optional(),
        isDefaultForSend: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      const { id, apiKey, accountId, apiBaseUrl: rawBaseUrl, ...rest } = data
      const current = (
        await db
          .select({ apiBaseUrl: providerConfig.apiBaseUrl })
          .from(providerConfig)
          .where(eq(providerConfig.id, id))
          .limit(1)
      ).at(0)
      if (!current) throw new AppError('not_found', '服务商不存在', 404)

      const apiBaseUrl = normalizeApiBaseUrl(rawBaseUrl)
      const currentBaseUrl =
        current.apiBaseUrl?.trim().replace(/\/+$/, '') || null
      // 只改地址、沿用旧 Key 会把已保存的 Key 发往新地址，等于变相回显明文
      // （编辑表单每次都会带上地址，未改动时不应要求重填 Key）
      if (
        apiBaseUrl !== undefined &&
        apiBaseUrl?.toLowerCase() !== currentBaseUrl?.toLowerCase() &&
        !apiKey
      ) {
        throw new AppError(
          'validation_failed',
          '修改 API 基地址时请同时重新填写 API Key',
        )
      }

      if (rest.isDefaultForSend) {
        await db.update(providerConfig).set({ isDefaultForSend: false })
      }
      await db
        .update(providerConfig)
        .set({
          ...rest,
          ...(apiBaseUrl !== undefined ? { apiBaseUrl } : {}),
          ...(accountId !== undefined
            ? { externalAccountId: accountId?.trim() || null }
            : {}),
          ...(apiKey
            ? { apiKeyEnc: encryptSecret(apiKey), apiKeyLast4: last4(apiKey) }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(providerConfig.id, id))
      await audit(actor.id, 'provider.update', 'provider', id, {
        apiBaseUrlChanged: apiBaseUrl !== undefined,
        apiKeyChanged: Boolean(apiKey),
      })
      return { id }
    }),
  )

export const adminDeleteProviderFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      const used = await db
        .select({ count: sql<number>`count(*)` })
        .from(domain)
        .where(eq(domain.providerConfigId, data.id))
      if (Number(used[0]?.count ?? 0) > 0) {
        throw new AppError('conflict', '仍有域名绑定该服务商，不能删除', 409)
      }
      // 不依赖外键级联：libSQL 连接池/远程库不保证 foreign_keys 开启。
      await db.batch([
        db
          .delete(webhookEndpoint)
          .where(eq(webhookEndpoint.providerConfigId, data.id)),
        db.delete(providerConfig).where(eq(providerConfig.id, data.id)),
      ])
      await audit(actor.id, 'provider.delete', 'provider', data.id)
      return { id: data.id }
    }),
  )

/* ------------------------------------------------------------- whooks */

export const adminListWebhooksFn = createServerFn({ method: 'GET' }).handler(
  async () =>
    attempt(async () => {
      await requireAdmin()
      const rows = await db
        .select({
          endpoint: webhookEndpoint,
          providerLabel: providerConfig.label,
          providerKind: providerConfig.kind,
        })
        .from(webhookEndpoint)
        .leftJoin(
          providerConfig,
          eq(providerConfig.id, webhookEndpoint.providerConfigId),
        )
        .orderBy(desc(webhookEndpoint.createdAt))
      return rows.map((row) => ({
        id: row.endpoint.id,
        label: row.endpoint.label,
        enabled: row.endpoint.enabled,
        lastEventAt: row.endpoint.lastEventAt,
        eventCount: row.endpoint.eventCount,
        providerLabel: row.providerLabel ?? '',
        providerKind: row.providerKind ?? 'resend',
        hasSecret: Boolean(row.endpoint.signingSecretEnc),
      }))
    }),
)

export const adminCreateWebhookFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z
      .object({
        providerConfigId: z.string(),
        label: z.string().min(1).max(60),
        signingSecret: z.string().min(8),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      const id = idPart()
      await db.insert(webhookEndpoint).values({
        id,
        providerConfigId: data.providerConfigId,
        label: data.label,
        signingSecretEnc: encryptSecret(data.signingSecret),
        enabled: true,
        createdAt: new Date(),
      })
      await audit(actor.id, 'webhook.create', 'webhook', id)
      return { id }
    }),
  )

export const adminUpdateWebhookFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z
      .object({
        id: z.string(),
        label: z.string().min(1).max(60).optional(),
        enabled: z.boolean().optional(),
        signingSecret: z.string().min(8).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      const { id, signingSecret, ...rest } = data
      const values: {
        label?: string
        enabled?: boolean
        signingSecretEnc?: string
      } = {}
      if (rest.label !== undefined) values.label = rest.label
      if (rest.enabled !== undefined) values.enabled = rest.enabled
      if (signingSecret) values.signingSecretEnc = encryptSecret(signingSecret)
      if (Object.keys(values).length === 0) return { id }
      await db
        .update(webhookEndpoint)
        .set(values)
        .where(eq(webhookEndpoint.id, id))
      await audit(actor.id, 'webhook.update', 'webhook', id, {
        enabled: rest.enabled,
      })
      return { id }
    }),
  )

export const adminDeleteWebhookFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      await db.delete(webhookEndpoint).where(eq(webhookEndpoint.id, data.id))
      await audit(actor.id, 'webhook.delete', 'webhook', data.id)
      return { id: data.id }
    }),
  )

/* ----------------------------------------------------------- login methods */

const LOGIN_METHOD_KINDS = [
  'email',
  'google',
  'github',
  'oidc',
  'passkey',
] as const
type LoginMethodKind = (typeof LOGIN_METHOD_KINDS)[number]

const LOGIN_METHOD_NAMES: Record<LoginMethodKind, string> = {
  email: '邮箱密码',
  google: 'Google',
  github: 'GitHub',
  oidc: '通用 OIDC',
  passkey: 'Passkey',
}

const OAUTH_METHOD_KINDS = new Set<LoginMethodKind>([
  'google',
  'github',
  'oidc',
])

function isOAuthMethod(kind: LoginMethodKind) {
  return OAUTH_METHOD_KINDS.has(kind)
}

/** OIDC 的 providerId 会成为回调路径段，只允许小写字母、数字与中划线 */
const PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/
/** 内置登录方式占用的 ID，不能被 OIDC 复用 */
const RESERVED_PROVIDER_IDS = new Set<string>([
  'email',
  'google',
  'github',
  'passkey',
])

function normalizeOidcProviderId(raw: string | undefined): string {
  const value = raw?.trim().toLowerCase() ?? ''
  if (!value) {
    throw new AppError('validation_failed', '请填写回调标识（providerId）')
  }
  if (!PROVIDER_ID_PATTERN.test(value)) {
    throw new AppError(
      'validation_failed',
      '回调标识只能包含小写字母、数字和中划线，长度 1–40',
    )
  }
  if (RESERVED_PROVIDER_IDS.has(value)) {
    throw new AppError(
      'validation_failed',
      `「${value}」是内置登录方式的保留标识`,
    )
  }
  return value
}

async function countEnabledMethods() {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(authProvider)
    .where(eq(authProvider.enabled, true))
  return Number(rows[0]?.count ?? 0)
}

async function invalidateLoginMethodCaches() {
  await bumpAuthConfigVersion()
  invalidateAuthCache()
  invalidatePublicLoginConfig()
}

export const adminListLoginMethodsFn = createServerFn({
  method: 'GET',
}).handler(async () =>
  attempt(async () => {
    await requireAdmin()
    const [rows, settings, canSend] = await Promise.all([
      db
        .select()
        .from(authProvider)
        .orderBy(authProvider.sortOrder, authProvider.createdAt),
      getSiteSettings(true),
      canSendSystemMail(),
    ])
    return {
      methods: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        providerId: row.providerId,
        displayName: row.displayName,
        enabled: row.enabled,
        clientId: row.clientId,
        hasSecret: Boolean(row.clientSecretEnc),
        issuer: row.issuer,
        scopes: row.scopes,
      })),
      emailVerification: {
        enabled: settings.emailVerificationRequired,
        canSend,
      },
    }
  }),
)

const createLoginMethodSchema = z.object({
  kind: z.enum(LOGIN_METHOD_KINDS),
  /** 仅 OIDC 使用：自定义回调标识 /api/auth/callback/{providerId} */
  providerId: z.string().max(40).optional(),
  displayName: z.string().min(1).max(40).optional(),
  clientId: z.string().max(300).nullable().optional(),
  clientSecret: z.string().max(300).optional(),
  issuer: z.string().max(300).nullable().optional(),
  scopes: z.string().max(200).nullable().optional(),
})

export const adminCreateLoginMethodFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => createLoginMethodSchema.parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()

      const kind = data.kind
      const oauth = isOAuthMethod(kind)
      const providerId =
        kind === 'oidc' ? normalizeOidcProviderId(data.providerId) : kind

      const existing = (
        await db
          .select({ id: authProvider.id })
          .from(authProvider)
          .where(eq(authProvider.providerId, providerId))
          .limit(1)
      ).at(0)
      if (existing) {
        throw new AppError('conflict', '该回调标识已被使用', 409)
      }

      if (oauth) {
        if (!data.clientId?.trim()) {
          throw new AppError('validation_failed', '请填写 Client ID')
        }
        if (!data.clientSecret?.trim()) {
          throw new AppError('validation_failed', '请填写 Client Secret')
        }
        if (kind === 'oidc' && !data.issuer?.trim()) {
          throw new AppError('validation_failed', '请填写 OIDC Issuer')
        }
      }

      const id = idPart()
      await db.insert(authProvider).values({
        id,
        kind,
        providerId,
        displayName: data.displayName?.trim() || LOGIN_METHOD_NAMES[kind],
        enabled: true,
        clientId: oauth ? (data.clientId?.trim() ?? null) : null,
        clientSecretEnc:
          oauth && data.clientSecret ? encryptSecret(data.clientSecret) : null,
        issuer: kind === 'oidc' ? (data.issuer?.trim() ?? null) : null,
        scopes: oauth ? data.scopes?.trim() || null : null,
        sortOrder: LOGIN_METHOD_KINDS.indexOf(kind),
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: actor.id,
      })

      await invalidateLoginMethodCaches()
      await audit(actor.id, 'login_method.create', 'auth_provider', id, {
        kind,
        providerId,
      })
      return { id, kind, providerId }
    }),
  )

export const adminUpdateLoginMethodFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z
      .object({
        id: z.string(),
        enabled: z.boolean().optional(),
        displayName: z.string().min(1).max(40).optional(),
        clientId: z.string().max(300).nullable().optional(),
        clientSecret: z.string().max(300).optional(),
        issuer: z.string().max(300).nullable().optional(),
        scopes: z.string().max(200).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      const row = (
        await db
          .select()
          .from(authProvider)
          .where(eq(authProvider.id, data.id))
          .limit(1)
      ).at(0)
      if (!row) throw new AppError('not_found', '登录方式不存在', 404)

      if (data.enabled === false && row.enabled) {
        const enabled = await countEnabledMethods()
        if (enabled <= 1) {
          throw new AppError('conflict', '至少保留一种登录方式', 409)
        }
      }

      const kind = row.kind as LoginMethodKind
      const oauth = isOAuthMethod(kind)
      const { id, clientSecret, ...rest } = data
      await db
        .update(authProvider)
        .set({
          ...rest,
          ...(kind === 'oidc' && data.issuer !== undefined
            ? { issuer: data.issuer?.trim() || null }
            : {}),
          ...(oauth && data.clientId !== undefined
            ? { clientId: data.clientId?.trim() || null }
            : {}),
          ...(clientSecret
            ? { clientSecretEnc: encryptSecret(clientSecret) }
            : {}),
          updatedAt: new Date(),
          updatedBy: actor.id,
        })
        .where(eq(authProvider.id, id))

      await invalidateLoginMethodCaches()
      await audit(actor.id, 'login_method.update', 'auth_provider', id, {
        enabled: data.enabled,
      })
      return { id }
    }),
  )

export const adminDeleteLoginMethodFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      const row = (
        await db
          .select()
          .from(authProvider)
          .where(eq(authProvider.id, data.id))
          .limit(1)
      ).at(0)
      if (!row) throw new AppError('not_found', '登录方式不存在', 404)

      if (row.enabled) {
        const enabled = await countEnabledMethods()
        if (enabled <= 1) {
          throw new AppError('conflict', '至少保留一种登录方式', 409)
        }
      }

      await db.delete(authProvider).where(eq(authProvider.id, data.id))
      await invalidateLoginMethodCaches()
      await audit(actor.id, 'login_method.delete', 'auth_provider', data.id, {
        providerId: row.providerId,
      })
      return { id: data.id }
    }),
  )

export const adminSetEmailVerificationFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => z.object({ enabled: z.boolean() }).parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()

      if (data.enabled && !(await canSendSystemMail())) {
        throw new AppError(
          'validation_failed',
          '请先在「服务商」配置可发信的已验证域名',
        )
      }

      await getSiteSettings()
      await db
        .update(siteSettings)
        .set({
          emailVerificationRequired: data.enabled,
          updatedAt: new Date(),
          updatedBy: actor.id,
        })
        .where(eq(siteSettings.id, 'default'))

      if (data.enabled) {
        // 规则见 exemptExistingUsersFromVerification；存量密码用户需补一次验证
        await exemptExistingUsersFromVerification()
      }

      await getSiteSettings(true)
      await invalidateLoginMethodCaches()
      await audit(
        actor.id,
        'login_method.email_verification',
        'site',
        'default',
        { enabled: data.enabled },
      )
      return { enabled: data.enabled }
    }),
  )

/* -------------------------------------------------------------------- users */

export const adminListUsersFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z
      .object({
        q: z.string().max(80).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).max(100_000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      await requireAdmin()
      const limit = data.limit ?? 50
      const offset = data.offset ?? 0
      const q = data.q?.trim()
      const conditions = q ? containsInsensitive(user.email, q) : undefined

      const rows = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          banned: user.banned,
          mailboxLimit: user.mailboxLimit,
          sendLimit: user.sendLimit,
          createdAt: user.createdAt,
          mailboxCount: sql<number>`(
            select count(*) from mailbox mb
            where mb.user_id = ${user.id} and mb.status != 'deleted'
          )`,
        })
        .from(user)
        .where(conditions)
        .orderBy(desc(user.createdAt))
        .limit(limit + 1)
        .offset(offset)

      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      const ids = page.map((row) => row.id)

      // 登录来源按 account 行（credential / 各 OAuth provider）聚合，
      // Passkey 在独立表里，按用户计数单独展示
      const [links, passkeyCounts, loginProviders] = await Promise.all([
        ids.length > 0
          ? db
              .select({
                userId: account.userId,
                providerId: account.providerId,
              })
              .from(account)
              .where(inArray(account.userId, ids))
              .orderBy(account.createdAt)
          : Promise.resolve([] as { userId: string; providerId: string }[]),
        ids.length > 0
          ? db
              .select({
                userId: passkey.userId,
                count: sql<number>`count(*)`,
              })
              .from(passkey)
              .where(inArray(passkey.userId, ids))
              .groupBy(passkey.userId)
          : Promise.resolve([] as { userId: string; count: number }[]),
        db
          .select({
            providerId: authProvider.providerId,
            displayName: authProvider.displayName,
            kind: authProvider.kind,
          })
          .from(authProvider),
      ])

      const providerById = new Map(
        loginProviders.map((row) => [row.providerId, row]),
      )
      const passkeyByUser = new Map(
        passkeyCounts.map((row) => [row.userId, Number(row.count)]),
      )

      // 同一 provider 理论上只有一条 account 行；历史脏数据存在重复，这里按 providerId 去重
      const methodsByUser = new Map<
        string,
        { providerId: string; label: string; kind: LoginAccountKind }[]
      >()
      for (const link of links) {
        const provider = providerById.get(link.providerId)
        const list = methodsByUser.get(link.userId) ?? []
        if (list.some((item) => item.providerId === link.providerId)) continue
        list.push({
          providerId: link.providerId,
          label: accountLabel(link.providerId, provider?.displayName),
          kind: accountKind(link.providerId, provider?.kind),
        })
        methodsByUser.set(link.userId, list)
      }

      return {
        rows: page.map((row) => ({
          ...row,
          createdAt: row.createdAt.getTime(),
          mailboxCount: Number(row.mailboxCount),
          passkeyCount: passkeyByUser.get(row.id) ?? 0,
          // 顺序即绑定顺序，第一条是注册时的来源
          loginMethods: methodsByUser.get(row.id) ?? [],
        })),
        hasMore,
      }
    }),
  )

export const adminUpdateUserFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z
      .object({
        id: z.string(),
        role: z.enum(['user', 'admin']).optional(),
        banned: z.boolean().optional(),
        mailboxLimit: z.number().int().min(0).max(100).nullable().optional(),
        sendLimit: z.number().int().min(0).max(1000).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      if (data.id === actor.id && data.role === 'user') {
        throw new AppError('validation_failed', '不能降级自己')
      }

      const current = (
        await db
          .select({ role: user.role, banned: user.banned })
          .from(user)
          .where(eq(user.id, data.id))
          .limit(1)
      )[0] as { role: string | null; banned: boolean | null } | undefined
      if (!current) throw new AppError('not_found', '用户不存在', 404)

      const { id, ...patch } = data
      await db
        .update(user)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(user.id, id))

      // 封禁或管理员降权时撤销已有会话；cookieCache 很短，剩余窗口有限
      if (
        (patch.banned === true && !current.banned) ||
        (patch.role === 'user' && current.role === 'admin')
      ) {
        await db.delete(session).where(eq(session.userId, id))
      }

      await audit(actor.id, 'user.update', 'user', id, patch)
      return { id }
    }),
  )

/* --------------------------------------------------------------------- logs */

const logQuerySchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).max(100_000).optional(),
})

export const adminListAuditFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => logQuerySchema.parse(data ?? {}))
  .handler(async ({ data }) =>
    attempt(async () => {
      await requireAdmin()
      const limit = data.limit ?? 100
      const offset = data.offset ?? 0
      const rows = await db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          targetType: auditLog.targetType,
          targetId: auditLog.targetId,
          createdAt: auditLog.createdAt,
          actorEmail: user.email,
        })
        .from(auditLog)
        .leftJoin(user, eq(user.id, auditLog.actorUserId))
        .orderBy(desc(auditLog.createdAt))
        .limit(limit + 1)
        .offset(offset)
      const hasMore = rows.length > limit
      return {
        rows: (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
          ...row,
          createdAt: row.createdAt.getTime(),
        })),
        hasMore,
      }
    }),
  )

export const adminListWebhookEventsFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => logQuerySchema.parse(data ?? {}))
  .handler(async ({ data }) =>
    attempt(async () => {
      await requireAdmin()
      const limit = data.limit ?? 100
      const offset = data.offset ?? 0
      const rows = await db
        .select({
          id: webhookEvent.id,
          type: webhookEvent.type,
          status: webhookEvent.status,
          error: webhookEvent.error,
          receivedAt: webhookEvent.receivedAt,
        })
        .from(webhookEvent)
        .orderBy(desc(webhookEvent.receivedAt))
        .limit(limit + 1)
        .offset(offset)
      const hasMore = rows.length > limit
      return {
        rows: (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
          ...row,
          receivedAt: row.receivedAt.getTime(),
        })),
        hasMore,
      }
    }),
  )

export const adminListUnroutedFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => logQuerySchema.parse(data ?? {}))
  .handler(async ({ data }) =>
    attempt(async () => {
      await requireAdmin()
      const limit = data.limit ?? 50
      const offset = data.offset ?? 0
      const rows = await db
        .select({
          id: unroutedMessage.id,
          from: unroutedMessage.fromAddress,
          subject: unroutedMessage.subject,
          reason: unroutedMessage.reason,
          createdAt: unroutedMessage.createdAt,
        })
        .from(unroutedMessage)
        .orderBy(desc(unroutedMessage.createdAt))
        .limit(limit + 1)
        .offset(offset)
      const hasMore = rows.length > limit
      return {
        rows: (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
          ...row,
          createdAt: row.createdAt.getTime(),
        })),
        hasMore,
      }
    }),
  )
