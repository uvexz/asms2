import { and, eq, inArray, lt, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import { db, isLocalDatabase } from '#/db/client'
import {
  attachment,
  auditLog,
  dailyUsage,
  powChallenge,
  rateLimit,
  mailbox,
  message,
  outboundRequest,
  messageBody,
  session,
  telegramBindCode,
  telegramUpdate,
  unroutedMessage,
  verification,
  webhookEvent,
} from '#/db/schema'
import { logError } from '#/server/errors'
import { getSiteSettings } from '#/server/settings'
import { refundSendQuota } from '#/server/mail/quota'
import {
  softDeleteMailbox,
  sweepMailboxQuota,
} from '#/server/mail/mailbox-quota'

const CHUNK_SIZE = 2_000
const MAX_CHUNKS = 20
/** 删邮件要按 id 列表同时删三张表，单批不宜过大（SQL 变量个数有限） */
const MESSAGE_CHUNK_SIZE = 500
const TEMP_MAILBOX_BATCH = 100
const DELETED_MAILBOX_BATCH = 100
const USAGE_RETENTION_DAYS = 90
const AUDIT_RETENTION_DAYS = 365
const UNCERTAIN_REQUEST_RETENTION_DAYS = 90

export interface SweepStats {
  expiredMailboxes: number
  purgedMailboxes: number
  purgedMessages: number
  purgedDeletedMailboxes: number
  purgedDeletedMessages: number
  purgedTrash: number
  purgedUnrouted: number
  purgedEvents: number
  purgedTelegramUpdates: number
  purgedBindCodes: number
  purgedSessions: number
  purgedVerifications: number
  purgedUsage: number
  purgedPowChallenges: number
  purgedRateLimits: number
  purgedAuditLogs: number
}

/**
 * 每次只取一批主键删除，避免单条 DELETE 长时间占用写锁；
 * 剩余数据由下一分钟的 sweep 继续清理。
 */
async function deleteInChunks(params: {
  table: SQLiteTable
  key: SQLiteColumn
  where: SQL
  chunk?: number
  maxChunks?: number
}): Promise<number> {
  const chunk = params.chunk ?? CHUNK_SIZE
  let total = 0

  for (let i = 0; i < (params.maxChunks ?? MAX_CHUNKS); i += 1) {
    const result = await db.run(sql`
      delete from ${params.table}
      where ${params.key} in (
        select ${params.key}
        from ${params.table}
        where ${params.where}
        limit ${chunk}
      )
    `)
    const deleted = Number(result.rowsAffected)
    total += deleted
    if (deleted < chunk) break
  }

  return total
}

/**
 * 删邮件时显式带上 message_body / attachment，不依赖 ON DELETE CASCADE：
 * libSQL 连接池里只有首个连接执行过 PRAGMA foreign_keys=ON，远程 Turso 也不保证，
 * 依赖级联会让正文（含 html_raw）以孤儿行残留，等于「删了但没删」。
 */
async function purgeMessages(where: SQL): Promise<number> {
  let total = 0

  for (let i = 0; i < MAX_CHUNKS; i += 1) {
    const rows = await db
      .select({ id: message.id })
      .from(message)
      .where(where)
      .limit(MESSAGE_CHUNK_SIZE)
    if (rows.length === 0) break

    const ids = rows.map((row) => row.id)
    await db.batch([
      db.delete(attachment).where(inArray(attachment.messageId, ids)),
      db.delete(messageBody).where(inArray(messageBody.messageId, ids)),
      db.delete(message).where(inArray(message.id, ids)),
    ])
    total += ids.length
    if (ids.length < MESSAGE_CHUNK_SIZE) break
  }

  return total
}

async function optimizePlanner() {
  if (!isLocalDatabase) return
  await db.run(sql`pragma optimize`).catch(() => undefined)
}

/**
 * 每分钟跑一次（外部 cron 打 /api/cron/sweep）。
 * 全部用「先算时间点，再按索引扫」的写法，避免 SQLite 里做时间函数运算。
 */
export async function sweep(): Promise<SweepStats> {
  const settings = await getSiteSettings()
  const now = Date.now()

  const expired = await db
    .update(mailbox)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(
      and(
        eq(mailbox.kind, 'temp'),
        eq(mailbox.status, 'active'),
        lt(mailbox.expiresAt, new Date()),
      ),
    )

  const graceCutoff = new Date(now - settings.tempGraceMinutes * 60 * 1000)

  // grace 结束后清空临时邮箱的邮件，但保留邮箱墓碑用于冷却期判断。
  // 每批最多处理 100 个邮箱，避免单次事务过大。
  const staleTemp = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.kind, 'temp'),
        eq(mailbox.status, 'expired'),
        lt(mailbox.expiresAt, graceCutoff),
      ),
    )
    .limit(TEMP_MAILBOX_BATCH)

  let purgedMessages = 0
  if (staleTemp.length > 0) {
    const ids = staleTemp.map((item) => item.id)
    // 先删邮件（含正文/附件），再墓碑化邮箱；本轮没删完的由下方「已删除邮箱」分支继续
    purgedMessages = await purgeMessages(inArray(message.mailboxId, ids))
    const stale = await db
      .select({ id: mailbox.id, address: mailbox.address })
      .from(mailbox)
      .where(inArray(mailbox.id, ids))
    for (const box of stale) {
      await softDeleteMailbox({
        id: box.id,
        address: box.address,
        kind: 'temp',
        deletedAt: graceCutoff,
      })
    }
  }

  // 已删除邮箱：保留期与地址冷却期都结束后，先分块清空邮件，再删除墓碑。
  // 有剩余邮件时不删 mailbox，下一分钟继续，避免一次性级联删除过多行。
  const retentionSeconds = settings.deletedMailboxRetentionDays * 24 * 3600
  const tempDeleteCutoff = new Date(
    now - Math.max(retentionSeconds, settings.tempCooldownHours * 3600) * 1000,
  )
  const permanentDeleteCutoff = new Date(
    now -
      Math.max(retentionSeconds, settings.permanentCooldownDays * 24 * 3600) *
        1000,
  )
  const deletedMailboxes = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.status, 'deleted'),
        or(
          and(
            eq(mailbox.kind, 'temp'),
            lt(mailbox.deletedAt, tempDeleteCutoff),
          ),
          and(
            eq(mailbox.kind, 'permanent'),
            lt(mailbox.deletedAt, permanentDeleteCutoff),
          ),
        ),
      ),
    )
    .limit(DELETED_MAILBOX_BATCH)

  let purgedDeletedMailboxes = 0
  let purgedDeletedMessages = 0
  if (deletedMailboxes.length > 0) {
    const ids = deletedMailboxes.map((item) => item.id)
    purgedDeletedMessages = await purgeMessages(inArray(message.mailboxId, ids))

    const remaining = await db
      .select({ id: message.id })
      .from(message)
      .where(inArray(message.mailboxId, ids))
      .limit(1)

    if (remaining.length === 0) {
      const removed = await db.delete(mailbox).where(inArray(mailbox.id, ids))
      purgedDeletedMailboxes = Number(removed.rowsAffected)
    }
  }

  // 回收站保留：从移入回收站的时间算起（trashed_at），而不是收信时间
  const trashCutoff = new Date(
    now - settings.trashRetentionDays * 24 * 3600 * 1000,
  )
  const purgedTrash = await purgeMessages(
    and(eq(message.folder, 'trash'), lt(message.trashedAt, trashCutoff))!,
  )

  const unroutedCutoff = new Date(
    now - settings.orphanRetentionDays * 24 * 3600 * 1000,
  )
  const purgedUnrouted = await deleteInChunks({
    table: unroutedMessage,
    key: unroutedMessage.id,
    where: or(
      lt(unroutedMessage.createdAt, unroutedCutoff),
      and(
        sql`${unroutedMessage.expiresAt} is not null`,
        lt(unroutedMessage.expiresAt, new Date(now)),
      ),
    )!,
  })

  const eventCutoff = new Date(now - 30 * 24 * 3600 * 1000)
  const purgedEvents = await deleteInChunks({
    table: webhookEvent,
    key: webhookEvent.id,
    where: lt(webhookEvent.receivedAt, eventCutoff),
  })

  // Telegram：update_id 只需保留一天（重推窗口远小于此），绑定码过期一天后回收
  const tgUpdateCutoff = new Date(now - 24 * 3600 * 1000)
  const purgedTelegramUpdates = await deleteInChunks({
    table: telegramUpdate,
    key: telegramUpdate.updateId,
    where: lt(telegramUpdate.createdAt, tgUpdateCutoff),
  })

  const purgedBindCodes = await deleteInChunks({
    table: telegramBindCode,
    key: telegramBindCode.code,
    where: lt(telegramBindCode.createdAt, tgUpdateCutoff),
  })

  // Better Auth 的会话与验证记录不会自动回收，过期后由这里分批清理
  const purgedSessions = await deleteInChunks({
    table: session,
    key: session.id,
    where: lt(session.expiresAt, new Date(now)),
    chunk: 1_000,
  })

  const purgedVerifications = await deleteInChunks({
    table: verification,
    key: verification.id,
    where: lt(verification.expiresAt, new Date(now)),
    chunk: 1_000,
  })

  const usageCutoff = new Date(now - USAGE_RETENTION_DAYS * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10)
  const purgedUsage = await deleteInChunks({
    table: dailyUsage,
    key: dailyUsage.id,
    where: lt(dailyUsage.usageDate, usageCutoff),
    chunk: 1_000,
  })

  // 防重放记录过期即可删；限流计数 1 天没动过的说明早已出了任何窗口
  const purgedPowChallenges = await deleteInChunks({
    table: powChallenge,
    key: powChallenge.salt,
    where: lt(powChallenge.expiresAt, new Date(now)),
    chunk: 1_000,
  })
  const purgedRateLimits = await deleteInChunks({
    table: rateLimit,
    key: rateLimit.id,
    where: lt(rateLimit.lastRequest, now - 24 * 3600 * 1000),
    chunk: 1_000,
  })

  // 发信请求：卡死的派发转 unknown（不自动重发），失败请求补退配额，
  // 已完成/已明确失败的请求保留 7 天作为幂等窗口后清理。
  const dispatchCutoff = new Date(now - 15 * 60 * 1000)
  const stuck = await db
    .select({
      id: outboundRequest.id,
      error: outboundRequest.error,
    })
    .from(outboundRequest)
    .where(
      and(
        eq(outboundRequest.status, 'processing'),
        lt(outboundRequest.updatedAt, dispatchCutoff),
      ),
    )
  for (const request of stuck) {
    await db
      .update(outboundRequest)
      .set({
        status: 'uncertain',
        error:
          request.error ??
          '派发超时，服务商可能已受理；请人工对账后再决定是否重发',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outboundRequest.id, request.id),
          eq(outboundRequest.status, 'processing'),
        ),
      )
  }

  const refundable = await db
    .select({
      id: outboundRequest.id,
      userId: outboundRequest.userId,
      usageDate: outboundRequest.usageDate,
    })
    .from(outboundRequest)
    .where(
      and(
        eq(outboundRequest.status, 'failed'),
        eq(outboundRequest.quotaReserved, true),
      ),
    )
  for (const request of refundable) {
    const won = await db
      .update(outboundRequest)
      .set({ quotaReserved: false, updatedAt: new Date() })
      .where(
        and(
          eq(outboundRequest.id, request.id),
          eq(outboundRequest.quotaReserved, true),
        ),
      )
      .returning({ id: outboundRequest.id })
    if (won.length === 0) continue
    await refundSendQuota(request.userId, request.usageDate).catch(
      (error: unknown) => {
        logError('[sweep] refund failed:', error)
      },
    )
  }

  const requestRetentionCutoff = new Date(now - 7 * 24 * 3600 * 1000)
  await db.run(sql`
    delete from outbound_request
    where status in ('succeeded', 'failed')
      and updated_at < ${Math.floor(requestRetentionCutoff.getTime() / 1000)}
  `)

  // uncertain 代表可能已受理,保留更久供人工对账;90 天后仍无结论则归档删除。
  const uncertainCutoff = new Date(
    now - UNCERTAIN_REQUEST_RETENTION_DAYS * 24 * 3600 * 1000,
  )
  await db.run(sql`
    delete from outbound_request
    where status = 'uncertain'
      and updated_at < ${Math.floor(uncertainCutoff.getTime() / 1000)}
  `)

  const auditCutoff = new Date(now - AUDIT_RETENTION_DAYS * 24 * 3600 * 1000)
  const purgedAuditLogs = await deleteInChunks({
    table: auditLog,
    key: auditLog.id,
    where: lt(auditLog.createdAt, auditCutoff),
    chunk: 1_000,
  })

  await optimizePlanner()
  await sweepMailboxQuota()

  return {
    expiredMailboxes: Number(expired.rowsAffected),
    purgedMailboxes: staleTemp.length,
    purgedMessages,
    purgedDeletedMailboxes,
    purgedDeletedMessages,
    purgedTrash,
    purgedUnrouted,
    purgedEvents,
    purgedTelegramUpdates,
    purgedBindCodes,
    purgedSessions,
    purgedVerifications,
    purgedUsage,
    purgedPowChallenges,
    purgedRateLimits,
    purgedAuditLogs,
  }
}
