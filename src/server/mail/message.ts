import { and, desc, eq, like, lt, ne, or, sql } from 'drizzle-orm'

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
  ]

  if (filters.mailboxId) {
    await getMailboxOrThrow(userId, filters.mailboxId, { allowExpired: true })
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
    .innerJoin(mailbox, eq(mailbox.id, message.mailboxId))
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

export async function toggleStar(
  userId: string,
  messageId: string,
  starred: boolean,
) {
  const current = (
    await db
      .select({ isStarred: message.isStarred })
      .from(message)
      .where(
        and(
          eq(message.id, messageId),
          eq(message.userId, userId),
          visibleMailboxCondition(),
        ),
      )
      .limit(1)
  )[0]
  if (!current) throw new AppError('not_found', '邮件不存在', 404)

  const next = starred ?? !current.isStarred
  await db
    .update(message)
    .set({ isStarred: next })
    .where(and(eq(message.id, messageId), eq(message.userId, userId)))
  return next
}

export async function moveMessage(
  userId: string,
  messageId: string,
  folder: MessageFolder,
) {
  const result = await db
    .update(message)
    .set({ folder })
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
