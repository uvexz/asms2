import { and, eq, ne, sql } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'

import { db } from '#/db/client'
import { mailbox, mailboxQuota } from '#/db/schema'
import { AppError } from '#/server/errors'

export type MailboxQuotaKind = 'permanent' | 'temp'

const idPart = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 20)
export const TEMP_MAILBOXES_PER_HOUR = 20

/** UTC 秒对齐的小时桶；同一自然小时内的所有请求共用一个窗口。 */
export function quotaHourBucket(now = Date.now()): string {
  return String(Math.floor(now / 3_600_000))
}

export function isAddressConflict(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/i.test(error.message)
}

/**
 * 与 mailbox insert 放在同一个 batch 中，按受影响行数决定是否获得额度。
 * 并发下不再先 SELECT 后 INSERT；唯一的 mailboxId 可防止重复预占。
 */
export function reserveMailboxQuota(params: {
  userId: string
  kind: MailboxQuotaKind
  mailboxId: string
  limit: number
  hourBucket?: string
}) {
  const { userId, kind, mailboxId, limit } = params
  const hourBucket = kind === 'temp' ? params.hourBucket : null
  if (kind === 'temp' && !hourBucket) {
    throw new Error('临时邮箱配额缺少小时桶')
  }

  return db.run(sql`
    insert into mailbox_quota (id, user_id, kind, mailbox_id, hour_bucket, sent_at)
    select ${idPart()}, ${userId}, ${kind}, ${mailboxId}, ${hourBucket}, unixepoch()
    where (
      select count(*) from mailbox_quota
      where user_id = ${userId} and kind = ${kind}
        and (${hourBucket === null ? sql`1 = 1` : sql`hour_bucket = ${hourBucket}`})
    ) < ${limit}
    on conflict do nothing
  `)
}

export async function reserveMailboxQuotaOrThrow(params: {
  userId: string
  kind: MailboxQuotaKind
  mailboxId: string
  limit: number
  hourBucket?: string
}): Promise<void> {
  const result = await reserveMailboxQuota(params)
  if (Number(result.rowsAffected) > 0) return

  throw params.kind === 'permanent'
    ? new AppError(
        'mailbox_limit_reached',
        `长期邮箱已达上限（${params.limit} 个），请先删除不再使用的邮箱`,
        409,
      )
    : new AppError('rate_limited', '临时邮箱创建过于频繁，请稍后再试', 429)
}

export function releaseMailboxQuota(mailboxId: string) {
  return db.delete(mailboxQuota).where(eq(mailboxQuota.mailboxId, mailboxId))
}

/** 软删与额度归还同批执行；已删除的邮箱不得再次归还额度。 */
export async function softDeleteMailbox(params: {
  id: string
  address: string
  deletedAt?: Date
  now?: Date
}): Promise<void> {
  const now = params.now ?? new Date()
  await db.batch([
    db
      .update(mailbox)
      .set({
        status: 'deleted',
        address: `${params.address}#${params.id}`,
        expiresAt: null,
        deletedAt: params.deletedAt ?? now,
        updatedAt: now,
      })
      .where(and(eq(mailbox.id, params.id), ne(mailbox.status, 'deleted'))),
    releaseMailboxQuota(params.id),
  ])
}

/** 只清理不再关联有效邮箱的历史配额和过期临时桶。 */
export async function sweepMailboxQuota(): Promise<void> {
  await db.batch([
    db.run(sql`
      delete from mailbox_quota
      where not exists (select 1 from mailbox where mailbox.id = mailbox_quota.mailbox_id)
        and sent_at < ${Math.floor((Date.now() - 10 * 60_000) / 1000)}
    `),
    db.run(sql`
      delete from mailbox_quota
      where kind = 'temp' and hour_bucket <> ${quotaHourBucket()}
    `),
  ])
}
