import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { user } from './auth'

/**
 * Telegram Bot 单行配置：id 恒为 'default'。
 * Bot Token 与 Webhook Secret 均为 AES-256-GCM 密文，接口只回末四位。
 */
export const telegramBot = sqliteTable('telegram_bot', {
  id: text('id').primaryKey().default('default'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),

  botTokenEnc: text('bot_token_enc'),
  botTokenLast4: text('bot_token_last4'),
  /** getMe 返回的机器人 id / username，用于展示与深链 */
  botId: text('bot_id'),
  botUsername: text('bot_username'),

  webhookSecretEnc: text('webhook_secret_enc'),
  webhookSecretLast4: text('webhook_secret_last4'),
  webhookUrl: text('webhook_url'),
  webhookSetAt: integer('webhook_set_at', { mode: 'timestamp' }),

  lastError: text('last_error'),
  lastErrorAt: integer('last_error_at', { mode: 'timestamp' }),

  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull(),
  updatedBy: text('updated_by'),
})

/**
 * TG 会话绑定：一个 chat 只能绑一个站内账号；
 * 一个账号可以绑多个 chat（私聊 / 不同设备），靠 notifyEnabled + notifyScope 控制打扰。
 */
export const telegramLink = sqliteTable(
  'telegram_link',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    chatId: text('chat_id').notNull().unique(),
    tgUserId: text('tg_user_id'),
    tgUsername: text('tg_username'),
    tgFirstName: text('tg_first_name'),
    notifyEnabled: integer('notify_enabled', { mode: 'boolean' })
      .notNull()
      .default(true),
    /** 推送范围：全部 / 仅临时邮箱 / 仅长期邮箱 */
    notifyScope: text('notify_scope', {
      enum: ['all', 'temp', 'permanent'],
    })
      .notNull()
      .default('all'),
    linkedAt: integer('linked_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    lastNotifiedAt: integer('last_notified_at', { mode: 'timestamp' }),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [index('telegram_link_user_idx').on(table.userId)],
)

/** 一次性绑定码：网页生成 → TG /start <code> 消费，10 分钟有效 */
export const telegramBindCode = sqliteTable(
  'telegram_bind_code',
  {
    code: text('code').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    usedAt: integer('used_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index('telegram_bind_code_user_idx').on(table.userId),
    index('telegram_bind_code_created_idx').on(table.createdAt),
  ],
)

/** update_id 去重：Telegram 在超时后会重推，和 webhook_event 是同一套思路 */
export const telegramUpdate = sqliteTable(
  'telegram_update',
  {
    updateId: integer('update_id').primaryKey(),
    chatId: text('chat_id'),
    kind: text('kind'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [index('telegram_update_created_idx').on(table.createdAt)],
)
