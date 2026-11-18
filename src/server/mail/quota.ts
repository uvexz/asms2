import { and, eq, sql } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'

import { db } from '#/db/client'
import { dailyUsage } from '#/db/schema'

const idPart = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 20)

/** 按站点时区取 `YYYY-MM-DD`，作为每日配额的计数键 */
export function usageDateFor(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * 原子预留一次发件额度。
 * 单条 UPSERT + WHERE 守卫：受影响行数为 0 即超额，避免「先查后写」的竞态。
 */
export async function reserveSendQuota(
  userId: string,
  limit: number,
  usageDate: string,
): Promise<boolean> {
  if (limit <= 0) return false

  const result = await db.run(sql`
    insert into daily_usage (id, user_id, usage_date, sent_count, received_count, updated_at)
    values (${idPart()}, ${userId}, ${usageDate}, 1, 0, unixepoch())
    on conflict (user_id, usage_date)
    do update set sent_count = sent_count + 1, updated_at = unixepoch()
    where daily_usage.sent_count < ${limit}
  `)

  return Number(result.rowsAffected ?? 0) > 0
}

export async function refundSendQuota(userId: string, usageDate: string) {
  await db
    .update(dailyUsage)
    .set({
      sentCount: sql`case when ${dailyUsage.sentCount} > 0 then ${dailyUsage.sentCount} - 1 else 0 end`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(dailyUsage.userId, userId),
        eq(dailyUsage.usageDate, usageDate),
      ),
    )
}

export async function incrementReceivedCount(
  userId: string,
  usageDate: string,
) {
  await db.run(sql`
    insert into daily_usage (id, user_id, usage_date, sent_count, received_count, updated_at)
    values (${idPart()}, ${userId}, ${usageDate}, 0, 1, unixepoch())
    on conflict (user_id, usage_date)
    do update set received_count = received_count + 1, updated_at = unixepoch()
  `)
}

export async function getSendUsage(
  userId: string,
  limit: number,
  usageDate: string,
) {
  const row = (
    await db
      .select()
      .from(dailyUsage)
      .where(
        and(
          eq(dailyUsage.userId, userId),
          eq(dailyUsage.usageDate, usageDate),
        ),
      )
      .limit(1)
  )[0]

  const sent = row?.sentCount ?? 0
  return {
    date: usageDate,
    sent,
    limit,
    remaining: Math.max(limit - sent, 0),
  }
}
