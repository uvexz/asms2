import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { user } from './auth'
import { providerConfig } from './provider'

/** 日发件计数：按站点时区切日，原子 UPSERT 扣减配额 */
export const dailyUsage = sqliteTable(
  'daily_usage',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    usageDate: text('usage_date').notNull(),
    sentCount: integer('sent_count').notNull().default(0),
    receivedCount: integer('received_count').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    uniqueIndex('daily_usage_user_date_idx').on(table.userId, table.usageDate),
    index('daily_usage_usage_date_idx').on(table.usageDate),
  ],
)

/** 用户级邮箱配额；count 与创建的 mailboxId 一一绑定，删除时精确归还。 */
export const mailboxQuota = sqliteTable(
  'mailbox_quota',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    kind: text('kind', { enum: ['permanent', 'temp'] }).notNull(),
    mailboxId: text('mailbox_id').notNull().unique(),
    hourBucket: text('hour_bucket'),
    sentAt: integer('sent_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index('mailbox_quota_user_kind_idx').on(table.userId, table.kind),
    index('mailbox_quota_temp_bucket_idx').on(
      table.userId,
      table.kind,
      table.hourBucket,
    ),
  ],
)

/**
 * 发信业务请求。先持久化稳定 ID + 规范化载荷，再调用服务商。
 * 重试总是取回同一请求，绝不能因重试生成第二封邮件或第二条消息。
 */
export const outboundRequest = sqliteTable(
  'outbound_request',
  {
    id: text('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    requestHash: text('request_hash').notNull(),
    userId: text('user_id').notNull(),
    mailboxId: text('mailbox_id').notNull(),
    providerConfigId: text('provider_config_id').notNull(),
    payloadJson: text('payload_json').notNull(),
    status: text('status', {
      enum: [
        'pending',
        'processing',
        'submitted',
        'succeeded',
        'failed',
        'uncertain',
      ],
    }).notNull(),
    providerMessageId: text('provider_message_id'),
    messageId: text('message_id'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    usageDate: text('usage_date').notNull(),
    quotaReserved: integer('quota_reserved', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index('outbound_request_user_idx').on(table.userId, table.createdAt),
    index('outbound_request_status_idx').on(table.status, table.updatedAt),
  ],
)

/** Webhook 事件台账：既是幂等去重表，也是死信队列 */
export const webhookEvent = sqliteTable(
  'webhook_event',
  {
    id: text('id').primaryKey(),
    endpointId: text('endpoint_id').notNull(),
    providerConfigId: text('provider_config_id').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    type: text('type').notNull(),
    payloadJson: text('payload_json'),
    status: text('status', {
      enum: ['received', 'processed', 'ignored', 'failed'],
    })
      .notNull()
      .default('received'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(1),
    receivedAt: integer('received_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp' }),
  },
  (table) => [
    uniqueIndex('webhook_event_dedupe_idx').on(
      table.endpointId,
      table.providerEventId,
    ),
    index('webhook_event_created_idx').on(table.receivedAt),
    // 概览页按 status 统计失败事件，没有索引时每次进入都全表扫描
    index('webhook_event_status_idx').on(table.status),
  ],
)

/** 收件但找不到邮箱时的墓碑（无法 SMTP 退信，只能留证据） */
export const unroutedMessage = sqliteTable(
  'unrouted_message',
  {
    id: text('id').primaryKey(),
    providerConfigId: text('provider_config_id').references(
      () => providerConfig.id,
      { onDelete: 'set null' },
    ),
    providerMessageId: text('provider_message_id'),
    fromAddress: text('from_address'),
    toJson: text('to_json'),
    subject: text('subject'),
    reason: text('reason', {
      // 只是 TS 层枚举，SQLite 没有 CHECK 约束，新增取值无需迁移
      enum: [
        'unknown',
        'expired',
        'domain_disabled',
        'mailbox_disabled',
        'provider_mismatch',
      ],
    }).notNull(),
    payloadJson: text('payload_json'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
  },
  (table) => [
    index('unrouted_created_idx').on(table.createdAt),
    index('unrouted_provider_msg_idx').on(table.providerMessageId),
  ],
)

/** 管理操作审计：改配置、读正文、调配额 */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metaJson: text('meta_json'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index('audit_created_idx').on(table.createdAt),
    index('audit_actor_idx').on(table.actorUserId),
  ],
)

/**
 * 已使用过的工作量证明题目（salt 即题目 ID）。用于防重放：
 * 同一份解答只能用一次；过期后由 sweep 清理。
 */
export const powChallenge = sqliteTable(
  'pow_challenge',
  {
    salt: text('salt').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('pow_challenge_expires_idx').on(table.expiresAt)],
)
