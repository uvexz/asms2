import {
  and,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  like,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm'

import { db } from '#/db/client'
import { attachment, mailbox, message, messageBody } from '#/db/schema'
import { AppError } from '#/server/errors'

import { getMailboxOrThrow } from './mailbox'

export type MessageFolder = 'inbox' | 'sent' | 'trash' | 'spam' | 'archive'

export interface MessageFilters {
  mailboxId?: string
  folder: MessageFolder
  q?: string
  cursor?: string
  limit?: number
}

export interface MessageListItem {
  id: string
  mailboxId: string
  mailboxAddress: string
  direction: 'inbound' | 'outbound'
  folder: MessageFolder
  fromName: string | null
  fromAddress: string
  to: string[]
  subject: string | null
  snippet: string | null
  status: string
  isRead: boolean
  isStarred: boolean
  hasAttachments: boolean
  receivedAt: number
  createdAt: number
}

/** 邮箱软删后其邮件立即从列表/详情/操作中隐藏，保留期后再由 sweep 硬删 */
function visibleMailboxCondition() {
  return sql`exists (
    select 1 from ${mailbox}
    where ${mailbox.id} = ${message.mailboxId}
      and ${mailbox.status} <> 'deleted'
  )`
}

function parseCursor(cursor?: string): { at: Date; id: string } | null {
  if (!cursor) return null
  const index = cursor.lastIndexOf('_')
  if (index <= 0) return null
  const ms = Number(cursor.slice(0, index))
  const id = cursor.slice(index + 1)
  if (!Number.isFinite(ms) || !id) return null
  return { at: new Date(ms), id }
}

export function encodeCursor(item: { receivedAt: number; id: string }) {
  return `${item.receivedAt}_${item.id}`
}

export async function listMessages(
  userId: string,
  filters: MessageFilters,
): Promise<{ items: MessageListItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 30, 1), 50)
  const conditions = [
    eq(message.userId, userId),
    eq(message.folder, filters.folder),
    ne(mailbox.status, 'deleted'),
    // 与侧栏的 isVisible 对齐：未保留且已过期的临时邮箱不再出现在列表里，
    // 否则会出现「点开一封来自侧栏不存在邮箱的邮件」
    or(
      ne(mailbox.kind, 'temp'),
      isNotNull(mailbox.retainedAt),
      isNull(mailbox.expiresAt),
      gt(mailbox.expiresAt, new Date()),
    )!,
  ]

  if (filters.mailboxId) {
    conditions.push(eq(message.mailboxId, filters.mailboxId))
  }

  if (filters.q?.trim()) {
    const pattern = `%${filters.q.trim().toLowerCase()}%`
    conditions.push(
      or(
        like(sql`lower(coalesce(${message.subject}, ''))`, pattern),
        like(sql`lower(${message.fromAddress})`, pattern),
      )!,
    )
  }

  const cursor = parseCursor(filters.cursor)
  if (cursor) {
    conditions.push(
      or(
        lt(message.receivedAt, cursor.at),
        and(eq(message.receivedAt, cursor.at), lt(message.id, cursor.id)),
      )!,
    )
  }

  const rows = await db
    .select({
      id: message.id,
      mailboxId: message.mailboxId,
      mailboxAddress: mailbox.address,
      direction: message.direction,
      folder: message.folder,
      fromName: message.fromName,
      fromAddress: message.fromAddress,
      toJson: message.toJson,
      subject: message.subject,
      snippet: message.snippet,
      status: message.status,
      isRead: message.isRead,
      isStarred: message.isStarred,
      hasAttachments: message.hasAttachments,
      receivedAt: message.receivedAt,
      createdAt: message.createdAt,
    })
    .from(message)
    // 归属校验并进 join，省掉列表请求前的一次 getMailboxOrThrow 往返
    .innerJoin(
      mailbox,
      and(eq(mailbox.id, message.mailboxId), eq(mailbox.userId, userId))!,
    )
    .where(and(...conditions))
    .orderBy(desc(message.receivedAt), desc(message.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const sliced = hasMore ? rows.slice(0, limit) : rows

  const items: MessageListItem[] = sliced.map((row) => {
    let to: string[] = []
    try {
      to = JSON.parse(row.toJson) as string[]
    } catch {
      to = []
    }
    const receivedAt =
      row.receivedAt?.getTime() ?? row.createdAt.getTime() ?? Date.now()

    return {
      id: row.id,
      mailboxId: row.mailboxId,
      mailboxAddress: row.mailboxAddress ?? '',
      direction: row.direction,
      folder: row.folder as MessageFolder,
      fromName: row.fromName,
      fromAddress: row.fromAddress,
      to,
      subject: row.subject,
      snippet: row.snippet,
      status: row.status,
      isRead: row.isRead,
      isStarred: row.isStarred,
      hasAttachments: row.hasAttachments,
      receivedAt,
      createdAt: row.createdAt.getTime(),
    }
  })

  const last = items[items.length - 1]
  // 空结果时补一次归属校验，区分「邮箱不存在」和「这个邮箱没有邮件」
  if (filters.mailboxId && items.length === 0) {
    await getMailboxOrThrow(userId, filters.mailboxId, { allowExpired: true })
  }
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  }
}

export async function getMessage(
  userId: string,
  messageId: string,
  options: { includeRaw?: boolean; includeHeaders?: boolean } = {},
) {
  const row = (
    await db
      .select({
        message: message,
        body: messageBody,
        mailboxAddress: mailbox.address,
      })
      .from(message)
      .leftJoin(messageBody, eq(messageBody.messageId, message.id))
      .innerJoin(mailbox, eq(mailbox.id, message.mailboxId))
      .where(
        and(
          eq(message.id, messageId),
          eq(message.userId, userId),
          ne(mailbox.status, 'deleted'),
        ),
      )
      .limit(1)
  )[0]

  if (!row) throw new AppError('not_found', '邮件不存在', 404)

  const attachments =
    row.message.attachmentCount > 0
      ? await db
          .select()
          .from(attachment)
          .where(eq(attachment.messageId, messageId))
      : []

  const m = row.message
  return {
    ...m,
    mailboxAddress: row.mailboxAddress ?? '',
    html: row.body?.htmlSanitized ?? null,
    text: row.body?.textBody ?? null,
    to: JSON.parse(m.toJson) as string[],
    cc: m.ccJson ? (JSON.parse(m.ccJson) as string[]) : [],
    bcc: m.bccJson ? (JSON.parse(m.bccJson) as string[]) : [],
    receivedAt: m.receivedAt?.getTime() ?? m.createdAt.getTime(),
    createdAt: m.createdAt.getTime(),
    attachments: attachments.map((item) => ({
      id: item.id,
      filename: item.filename,
      contentType: item.contentType,
      size: item.size,
      isInline: item.isInline,
    })),
    ...(options.includeRaw ? { htmlRaw: row.body?.htmlRaw ?? null } : {}),
    ...(options.includeHeaders
      ? {
          headers: row.body?.headersJson
            ? JSON.parse(row.body.headersJson)
            : {},
        }
      : {}),
  }
}

export async function markRead(
  userId: string,
  messageId: string,
  read: boolean,
) {
  const result = await db
    .update(message)
    .set({ isRead: read })
    .where(
      and(
        eq(message.id, messageId),
        eq(message.userId, userId),
        visibleMailboxCondition(),
      ),
    )
    .returning({ id: message.id })
  if (result.length === 0) throw new AppError('not_found', '邮件不存在', 404)
}

export interface MessagePatch {
  isRead?: boolean
  isStarred?: boolean
  folder?: MessageFolder
}

/**
 * 一次写操作覆盖已读/星标/移动三种变更，避免 RPC 里串行跑多条 UPDATE。
 */
export async function updateMessage(
  userId: string,
  messageId: string,
  patch: MessagePatch,
) {
  const values: MessagePatch = {}
  if (typeof patch.isRead === 'boolean') values.isRead = patch.isRead
  if (typeof patch.isStarred === 'boolean') values.isStarred = patch.isStarred
  if (patch.folder) values.folder = patch.folder
  if (Object.keys(values).length === 0) return

  const result = await db
    .update(message)
    .set(values)
    .where(
      and(
        eq(message.id, messageId),
        eq(message.userId, userId),
        visibleMailboxCondition(),
      ),
    )
    .returning({ id: message.id })
  if (result.length === 0) throw new AppError('not_found', '邮件不存在', 404)
}
