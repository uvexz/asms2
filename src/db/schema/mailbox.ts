import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { user } from './auth'
import { domain } from './provider'

/**
 * 邮箱。address 全局唯一（localPart 小写 + 域名小写）。
 * 临时邮箱：创建时给一个「考察期」（expiresAt = created + ttl）；
 * 考察期内收到任意一封邮件即永久保留（retainedAt 有值、expiresAt 置空）。
 */
export const mailbox = sqliteTable(
  'mailbox',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    domainId: text('domain_id')
      .notNull()
      .references(() => domain.id, { onDelete: 'restrict' }),
    localPart: text('local_part').notNull(),
    address: text('address').notNull().unique(),
    displayName: text('display_name'),
    kind: text('kind', { enum: ['permanent', 'temp'] })
      .notNull()
      .default('permanent'),
    status: text('status', {
      enum: ['active', 'expired', 'disabled', 'deleted'],
    })
      .notNull()
      .default('active'),
    /** 仅临时邮箱有值；收到首封邮件后置空表示永久保留 */
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    /** 临时邮箱在考察期内收到邮件的时间，有值即永久保留 */
    retainedAt: integer('retained_at', { mode: 'timestamp' }),
    lastReceivedAt: integer('last_received_at', { mode: 'timestamp' }),
    lastSentAt: integer('last_sent_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  },
  (table) => [
    uniqueIndex('mailbox_domain_local_idx').on(table.domainId, table.localPart),
    index('mailbox_user_kind_idx').on(table.userId, table.kind, table.status),
    index('mailbox_sweep_idx').on(table.kind, table.status, table.expiresAt),
    index('mailbox_user_kind_created_idx').on(
      table.userId,
      table.kind,
      table.createdAt,
    ),
  ],
)

/**
 * 邮件主表：只放列表需要的元数据，正文拆到 message_body。
 * userId 冗余是为了「全部邮箱」视图免 join。
 */
export const message = sqliteTable(
  'message',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => mailbox.id, { onDelete: 'cascade' }),
    direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
    folder: text('folder', {
      enum: ['inbox', 'sent', 'trash', 'spam', 'archive'],
    })
      .notNull()
      .default('inbox'),
    providerConfigId: text('provider_config_id').notNull(),
    providerMessageId: text('provider_message_id'),
    internetMessageId: text('internet_message_id'),
    threadKey: text('thread_key'),

    fromName: text('from_name'),
    fromAddress: text('from_address').notNull(),
    toJson: text('to_json').notNull(),
    ccJson: text('cc_json'),
    bccJson: text('bcc_json'),
    replyToJson: text('reply_to_json'),

    subject: text('subject'),
    snippet: text('snippet'),

    status: text('status', {
      enum: [
        'received',
        'queued',
        'sent',
        'delivered',
        'bounced',
        'complained',
        'failed',
        'suppressed',
      ],
    })
      .notNull()
      .default('received'),

    isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
    isStarred: integer('is_starred', { mode: 'boolean' })
      .notNull()
      .default(false),
    hasAttachments: integer('has_attachments', { mode: 'boolean' })
      .notNull()
      .default(false),
    attachmentCount: integer('attachment_count').notNull().default(0),
    size: integer('size').notNull().default(0),

    sentAt: integer('sent_at', { mode: 'timestamp' }),
    receivedAt: integer('received_at', { mode: 'timestamp' }),
    errorMessage: text('error_message'),
    /** 移入回收站的时间；回收站保留期从这里算，移出时置空 */
    trashedAt: integer('trashed_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index('message_mailbox_idx').on(
      table.mailboxId,
      table.folder,
      table.receivedAt,
      table.id,
    ),
    index('message_user_idx').on(
      table.userId,
      table.folder,
      table.receivedAt,
      table.id,
    ),
    index('message_folder_received_idx').on(table.folder, table.receivedAt),
    // 回收站清理按「移入时间」扫描
    index('message_trash_idx').on(table.folder, table.trashedAt),
    // 未读数聚合只扫未读行：partial index 比全量 (mailbox, folder, is_read) 更小
    index('message_unread_idx')
      .on(table.mailboxId, table.folder, table.isRead)
      .where(sql`is_read = 0`),
    index('message_direction_idx').on(table.direction),
    uniqueIndex('message_provider_uidx').on(
      table.providerConfigId,
      table.providerMessageId,
    ),
    index('message_thread_idx').on(table.threadKey),
    index('message_imap_id_idx').on(table.internetMessageId),
  ],
)

/** 正文与原文头，1:1 */
export const messageBody = sqliteTable('message_body', {
  messageId: text('message_id')
    .primaryKey()
    .references(() => message.id, { onDelete: 'cascade' }),
  htmlRaw: text('html_raw'),
  htmlSanitized: text('html_sanitized'),
  textBody: text('text_body'),
  headersJson: text('headers_json'),
})

/** 附件只存元数据，内容按需向服务商代理下载 */
export const attachment = sqliteTable(
  'attachment',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => message.id, { onDelete: 'cascade' }),
    providerAttachmentId: text('provider_attachment_id'),
    filename: text('filename').notNull(),
    contentType: text('content_type'),
    size: integer('size').notNull().default(0),
    isInline: integer('is_inline', { mode: 'boolean' })
      .notNull()
      .default(false),
    contentId: text('content_id'),
  },
  (table) => [index('attachment_message_idx').on(table.messageId)],
)
