import { and, eq, lt, sql } from 'drizzle-orm'

import { db } from '#/db/client'
import {
  attachment,
  mailbox,
  message,
  messageBody,
  telegramBindCode,
  telegramUpdate,
  unroutedMessage,
  webhookEvent,
} from '#/db/schema'
import { getSiteSettings } from '#/server/settings'

export interface SweepStats {
  expiredMailboxes: number
  purgedMailboxes: number
  purgedMessages: number
  purgedTrash: number
  purgedUnrouted: number
  purgedEvents: number
  purgedTelegramUpdates: number
  purgedBindCodes: number
}

/**
 * 每分钟跑一次（外部 cron 打 /api/cron/sweep），也可在读取时惰性兜底。
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
    .returning({ id: mailbox.id })

  const graceCutoff = new Date(now - settings.tempGraceMinutes * 60 * 1000)

  // grace 结束后清空临时邮箱的邮件，但保留邮箱墓碑用于冷却期判断
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

  let purgedMessages = 0
  if (staleTemp.length > 0) {
    for (const item of staleTemp) {
      const rows = await db
        .delete(message)
        .where(eq(message.mailboxId, item.id))
        .returning({ id: message.id })
      purgedMessages += rows.length
      await db
        .update(mailbox)
        .set({
          status: 'deleted',
          address: sql`${mailbox.address} || '#' || ${mailbox.id}`,
          deletedAt: new Date(graceCutoff),
        })
        .where(eq(mailbox.id, item.id))
    }
  }

  // 回收站保留
  const trashCutoff = new Date(
    now - settings.trashRetentionDays * 24 * 3600 * 1000,
  )
  const trashRows = await db
    .delete(message)
    .where(
      and(eq(message.folder, 'trash'), lt(message.receivedAt, trashCutoff)),
    )
    .returning({ id: message.id })

  const unroutedCutoff = new Date(
    now - settings.orphanRetentionDays * 24 * 3600 * 1000,
  )
  const unroutedRows = await db
    .delete(unroutedMessage)
    .where(lt(unroutedMessage.createdAt, unroutedCutoff))
    .returning({ id: unroutedMessage.id })

  const eventCutoff = new Date(now - 30 * 24 * 3600 * 1000)
  const eventRows = await db
    .delete(webhookEvent)
    .where(lt(webhookEvent.receivedAt, eventCutoff))
    .returning({ id: webhookEvent.id })

  // Telegram：update_id 只需保留一天（重推窗口远小于此），绑定码过期一天后回收
  const tgUpdateCutoff = new Date(now - 24 * 3600 * 1000)
  const tgUpdateRows = await db
    .delete(telegramUpdate)
    .where(lt(telegramUpdate.createdAt, tgUpdateCutoff))
    .returning({ updateId: telegramUpdate.updateId })

  const bindCodeCutoff = new Date(now - 24 * 3600 * 1000)
  const bindCodeRows = await db
    .delete(telegramBindCode)
    .where(lt(telegramBindCode.createdAt, bindCodeCutoff))
    .returning({ code: telegramBindCode.code })

  return {
    expiredMailboxes: expired.length,
    purgedMailboxes: staleTemp.length,
    purgedMessages,
    purgedTrash: trashRows.length,
    purgedUnrouted: unroutedRows.length,
    purgedEvents: eventRows.length,
    purgedTelegramUpdates: tgUpdateRows.length,
    purgedBindCodes: bindCodeRows.length,
  }
}

/** 自检用：确认外键级联生效（SQLite 默认关闭，libSQL 默认开启） */
export async function ensurePragmas() {
  await db.run(sql`pragma foreign_keys = on`)
}

export const _tables = { attachment, messageBody }
