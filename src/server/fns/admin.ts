import { createServerFn } from '@tanstack/react-start'
import { desc, eq, ne, sql } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'
import { z } from 'zod'

import { db } from '#/db/client'
import {
  auditLog,
  authProvider,
  domain,
  mailbox,
  message,
  providerConfig,
  siteSettings,
  unroutedMessage,
  user,
  webhookEndpoint,
  webhookEvent,
} from '#/db/schema'
import { clientIp, requireAdmin, userAgent } from '#/server/auth/guards'
import { invalidateAuthCache } from '#/server/auth'
import { encryptSecret, last4 } from '#/server/crypto/secret-box'
import { AppError, attempt } from '#/server/errors'
import { getProviderById } from '#/server/mail/provider-config'
import { getProvider } from '#/server/providers'
import type { DnsRecord } from '#/server/providers'
import { bumpAuthConfigVersion, getSiteSettings } from '#/server/settings'

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
  emailVerificationRequired: z.boolean().optional(),
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
  adminCanReadMail: z.boolean().optional(),
  trashRetentionDays: z.number().int().min(1).max(365).optional(),
  orphanRetentionDays: z.number().int().min(1).max(365).optional(),
  timezone: z.string().max(60).optional(),
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
      )[0]
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
        apiBaseUrl: data.apiBaseUrl ?? null,
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
      const { id, apiKey, accountId, ...rest } = data
      if (rest.isDefaultForSend) {
        await db.update(providerConfig).set({ isDefaultForSend: false })
      }
      await db
        .update(providerConfig)
        .set({
          ...rest,
          ...(accountId !== undefined
            ? { externalAccountId: accountId?.trim() || null }
            : {}),
          ...(apiKey
            ? { apiKeyEnc: encryptSecret(apiKey), apiKeyLast4: last4(apiKey) }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(providerConfig.id, id))
      await audit(actor.id, 'provider.update', 'provider', id)
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
      await db.delete(providerConfig).where(eq(providerConfig.id, data.id))
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

/* ----------------------------------------------------------- auth providers */

export const adminListAuthProvidersFn = createServerFn({
  method: 'GET',
}).handler(async () =>
  attempt(async () => {
    await requireAdmin()
    const rows = await db
      .select()
      .from(authProvider)
      .orderBy(authProvider.sortOrder)
    return rows.map((row) => ({
      ...row,
      clientSecretEnc: undefined,
      hasSecret: Boolean(row.clientSecretEnc),
    }))
  }),
)

const authProviderSchema = z.object({
  providerId: z.enum(['google', 'github', 'oidc']),
  displayName: z.string().min(1).max(40),
  enabled: z.boolean().default(false),
  clientId: z.string().max(300).nullable().optional(),
  clientSecret: z.string().max(300).optional(),
  issuer: z.string().max(300).nullable().optional(),
  scopes: z.string().max(200).nullable().optional(),
})

export const adminUpsertAuthProviderFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => authProviderSchema.parse(data))
  .handler(async ({ data }) =>
    attempt(async () => {
      const actor = await requireAdmin()
      const existing = (
        await db
          .select()
          .from(authProvider)
          .where(eq(authProvider.providerId, data.providerId))
          .limit(1)
      )[0]

      const values = {
        providerId: data.providerId,
        displayName: data.displayName,
        enabled: data.enabled,
        clientId: data.clientId ?? null,
        issuer: data.issuer ?? null,
        scopes: data.scopes ?? null,
        updatedAt: new Date(),
        updatedBy: actor.id,
        ...(data.clientSecret
          ? { clientSecretEnc: encryptSecret(data.clientSecret) }
          : {}),
      }

      if (existing) {
        await db
          .update(authProvider)
          .set(values)
          .where(eq(authProvider.id, existing.id))
      } else {
        await db.insert(authProvider).values({
          id: idPart(),
          ...values,
          sortOrder: 0,
          createdAt: new Date(),
        })
      }

      await bumpAuthConfigVersion()
      invalidateAuthCache()
      await audit(
        actor.id,
        'auth_provider.upsert',
        'auth_provider',
        data.providerId,
      )
      return { providerId: data.providerId }
    }),
  )

/* -------------------------------------------------------------------- users */

export const adminListUsersFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z.object({ q: z.string().max(80).optional() }).parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      await requireAdmin()
      const conditions = data.q
        ? sql`lower(${user.email}) like ${`%${data.q.toLowerCase()}%`}`
        : undefined

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
        .limit(100)

      return rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.getTime(),
        mailboxCount: Number(row.mailboxCount ?? 0),
      }))
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
      const { id, ...patch } = data
      await db
        .update(user)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(user.id, id))
      await audit(actor.id, 'user.update', 'user', id, patch)
      return { id }
    }),
  )

/* --------------------------------------------------------------------- logs */

export const adminListAuditFn = createServerFn({ method: 'GET' }).handler(
  async () =>
    attempt(async () => {
      await requireAdmin()
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
        .limit(100)
      return rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.getTime(),
      }))
    }),
)

export const adminListWebhookEventsFn = createServerFn({
  method: 'GET',
}).handler(async () =>
  attempt(async () => {
    await requireAdmin()
    const rows = await db
      .select()
      .from(webhookEvent)
      .orderBy(desc(webhookEvent.receivedAt))
      .limit(100)
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      error: row.error,
      receivedAt: row.receivedAt.getTime(),
    }))
  }),
)

export const adminListUnroutedFn = createServerFn({ method: 'GET' }).handler(
  async () =>
    attempt(async () => {
      await requireAdmin()
      const rows = await db
        .select()
        .from(unroutedMessage)
        .orderBy(desc(unroutedMessage.createdAt))
        .limit(50)
      return rows.map((row) => ({
        id: row.id,
        from: row.fromAddress,
        subject: row.subject,
        reason: row.reason,
        createdAt: row.createdAt.getTime(),
      }))
    }),
)
