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
      enum: ['unknown', 'expired', 'domain_disabled'],
    }).notNull(),
    payloadJson: text('payload_json'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
  },
  (table) => [index('unrouted_created_idx').on(table.createdAt)],
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
