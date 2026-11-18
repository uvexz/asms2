import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * 单行站点配置：id 恒为 'default'。
 * 用 typed 列而不是 KV，管理面板表单与类型一一对应；零散扩展放 extraJson。
 */
export const siteSettings = sqliteTable('site_settings', {
  id: text('id').primaryKey().default('default'),

  siteName: text('site_name').notNull().default('asms2'),
  siteDescription: text('site_description')
    .notNull()
    .default('A Simple Mail Server'),
  logoUrl: text('logo_url'),
  faviconUrl: text('favicon_url'),
  siteUrl: text('site_url'),
  contactEmail: text('contact_email'),
  icpRecord: text('icp_record'),
  footerText: text('footer_text'),

  registrationEnabled: integer('registration_enabled', { mode: 'boolean' })
    .notNull()
    .default(true),
  emailVerificationRequired: integer('email_verification_required', {
    mode: 'boolean',
  })
    .notNull()
    .default(false),

  defaultMailboxLimit: integer('default_mailbox_limit').notNull().default(5),
  defaultDailySendLimit: integer('default_daily_send_limit')
    .notNull()
    .default(5),

  permanentPrefixMin: integer('permanent_prefix_min').notNull().default(3),
  tempPrefixMin: integer('temp_prefix_min').notNull().default(8),
  prefixMax: integer('prefix_max').notNull().default(32),

  tempTtlMinutes: integer('temp_ttl_minutes').notNull().default(60),
  tempGraceMinutes: integer('temp_grace_minutes').notNull().default(60),
  tempCooldownHours: integer('temp_cooldown_hours').notNull().default(24),
  permanentCooldownDays: integer('permanent_cooldown_days')
    .notNull()
    .default(30),

  allowTempSend: integer('allow_temp_send', { mode: 'boolean' })
    .notNull()
    .default(false),
  allowUserDomainChoice: integer('allow_user_domain_choice', {
    mode: 'boolean',
  })
    .notNull()
    .default(true),
  adminCanReadMail: integer('admin_can_read_mail', { mode: 'boolean' })
    .notNull()
    .default(false),

  trashRetentionDays: integer('trash_retention_days').notNull().default(30),
  orphanRetentionDays: integer('orphan_retention_days').notNull().default(7),
  timezone: text('timezone').notNull().default('Asia/Shanghai'),

  reservedWordsJson: text('reserved_words_json'),
  extraJson: text('extra_json'),

  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull(),
  updatedBy: text('updated_by'),
})

/** 第三方登录配置；保存后需要重建 Better Auth 实例 */
export const authProvider = sqliteTable('auth_provider', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().unique(),
  displayName: text('display_name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  clientId: text('client_id'),
  clientSecretEnc: text('client_secret_enc'),
  issuer: text('issuer'),
  scopes: text('scopes'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull(),
  updatedBy: text('updated_by'),
})

/** 运行时元信息：auth 配置版本、seed 标记等 */
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull(),
})
