import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { user } from './auth'

/**
 * 服务商实例。同一 kind 可以配置多份（不同账号 / 不同域名）。
 * apiKeyEnc / signingSecretEnc 均为 AES-256-GCM 密文，接口只回 last4。
 */
export const providerConfig = sqliteTable(
  'provider_config',
  {
    id: text('id').primaryKey(),
    kind: text('kind', {
      enum: [
        'resend',
        'unitpost',
        'ahasend',
        'groundmail',
        'mailtrap',
        'plunk',
        'reloop',
        'custom',
      ],
    })
      .notNull()
      .default('resend'),
    label: text('label').notNull(),
    apiKeyEnc: text('api_key_enc').notNull(),
    apiKeyLast4: text('api_key_last4'),
    apiBaseUrl: text('api_base_url'),
    /** 服务商侧的账号标识：AhaSend 的 API 路径必须带 account_id */
    externalAccountId: text('external_account_id'),
    capabilitiesJson: text('capabilities_json'),
    isDefaultForSend: integer('is_default_for_send', { mode: 'boolean' })
      .notNull()
      .default(false),
    status: text('status', { enum: ['active', 'invalid', 'disabled'] })
      .notNull()
      .default('active'),
    lastCheckedAt: integer('last_checked_at', { mode: 'timestamp' }),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    createdBy: text('created_by').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [index('provider_config_kind_idx').on(table.kind)],
)

export const domain = sqliteTable(
  'domain',
  {
    id: text('id').primaryKey(),
    hostname: text('hostname').notNull().unique(),
    providerConfigId: text('provider_config_id')
      .notNull()
      .references(() => providerConfig.id, { onDelete: 'restrict' }),
    providerDomainId: text('provider_domain_id'),
    /**
     * @deprecated 历史用途字段，仅为避免破坏性迁移而保留；
     * 新建权限以 allowPermanentCreate / allowTempCreate 为准。
     */
    purpose: text('purpose', { enum: ['permanent', 'temp', 'both'] })
      .notNull()
      .default('both'),
    /** 是否允许用户在该域名下新建长期邮箱（只管新建，不影响已有邮箱） */
    allowPermanentCreate: integer('allow_permanent_create', {
      mode: 'boolean',
    })
      .notNull()
      .default(true),
    /** 是否允许用户在该域名下新建临时邮箱 */
    allowTempCreate: integer('allow_temp_create', { mode: 'boolean' })
      .notNull()
      .default(true),
    status: text('status', {
      enum: ['pending', 'verified', 'failed', 'disabled'],
    })
      .notNull()
      .default('pending'),
    receivingEnabled: integer('receiving_enabled', { mode: 'boolean' })
      .notNull()
      .default(false),
    sendingEnabled: integer('sending_enabled', { mode: 'boolean' })
      .notNull()
      .default(false),
    isDefaultPermanent: integer('is_default_permanent', { mode: 'boolean' })
      .notNull()
      .default(false),
    isDefaultTemp: integer('is_default_temp', { mode: 'boolean' })
      .notNull()
      .default(false),
    dnsRecordsJson: text('dns_records_json'),
    lastCheckedAt: integer('last_checked_at', { mode: 'timestamp' }),
    verifiedAt: integer('verified_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index('domain_provider_idx').on(table.providerConfigId),
    index('domain_status_idx').on(table.status),
  ],
)

/**
 * Webhook 端点：URL 里的 publicId 就是这张表的主键。
 * 一个服务商可挂多个端点（对应服务商侧多个 webhook 配置）。
 */
export const webhookEndpoint = sqliteTable(
  'webhook_endpoint',
  {
    id: text('id').primaryKey(),
    providerConfigId: text('provider_config_id')
      .notNull()
      .references(() => providerConfig.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    signingSecretEnc: text('signing_secret_enc').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    lastEventAt: integer('last_event_at', { mode: 'timestamp' }),
    eventCount: integer('event_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index('webhook_endpoint_provider_idx').on(table.providerConfigId),
    uniqueIndex('webhook_endpoint_id_idx').on(table.id),
  ],
)
