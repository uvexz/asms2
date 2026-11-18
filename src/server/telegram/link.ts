import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'

import { db } from '#/db/client'
import { telegramBindCode, telegramLink, user } from '#/db/schema'
import type { TgUser } from './api'

const idPart = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 20)
/** 去掉 0/O/1/I/L 之类易混字符，方便手输 */
const codePart = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 8)

export const BIND_CODE_TTL_MS = 10 * 60 * 1000
export const MAX_LINKS_PER_USER = 3

export type TelegramLinkRow = typeof telegramLink.$inferSelect

/** 生成一次性绑定码；同一用户只保留最新一个未使用的码 */
export async function createBindCode(userId: string) {
  await db
    .delete(telegramBindCode)
    .where(
      and(eq(telegramBindCode.userId, userId), isNull(telegramBindCode.usedAt)),
    )

  const code = codePart()
  const expiresAt = new Date(Date.now() + BIND_CODE_TTL_MS)
  await db.insert(telegramBindCode).values({ code, userId, expiresAt })
  return { code, expiresAt }
}

/** 原子消费：并发下只有一个请求能把 usedAt 从 NULL 写成时间 */
export async function consumeBindCode(code: string): Promise<string | null> {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return null

  const rows = await db
    .update(telegramBindCode)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(telegramBindCode.code, normalized),
        isNull(telegramBindCode.usedAt),
        gt(telegramBindCode.expiresAt, new Date()),
      ),
    )
    .returning({ userId: telegramBindCode.userId })

  return rows[0]?.userId ?? null
}

export type BindChatResult =
  | { ok: true; link: TelegramLinkRow; email: string }
  | { ok: false; reason: 'chat_taken' | 'link_limit' | 'user_missing' }

export async function bindChat(params: {
  chatId: string
  userId: string
  tgUser: TgUser
}): Promise<BindChatResult> {
  const { chatId, userId, tgUser } = params

  const owner = (
    await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
  )[0]
  if (!owner) return { ok: false, reason: 'user_missing' }

  const existing = (
    await db
      .select()
      .from(telegramLink)
      .where(eq(telegramLink.chatId, chatId))
      .limit(1)
  )[0]

  if (existing && existing.userId !== userId) {
    return { ok: false, reason: 'chat_taken' }
  }

  if (!existing) {
    const countRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(telegramLink)
      .where(eq(telegramLink.userId, userId))
    if (Number(countRows[0]?.count ?? 0) >= MAX_LINKS_PER_USER) {
      return { ok: false, reason: 'link_limit' }
    }
  }

  const values = {
    userId,
    chatId,
    tgUserId: String(tgUser.id),
    tgUsername: tgUser.username ?? null,
    tgFirstName: tgUser.first_name ?? null,
    updatedAt: new Date(),
  }

  const rows = existing
    ? await db
        .update(telegramLink)
        .set(values)
        .where(eq(telegramLink.id, existing.id))
        .returning()
    : await db
        .insert(telegramLink)
        .values({ id: idPart(), ...values, linkedAt: new Date() })
        .returning()

  return { ok: true, link: rows[0], email: owner.email }
}

export async function getLinkByChat(
  chatId: string,
): Promise<TelegramLinkRow | null> {
  return (
    (
      await db
        .select()
        .from(telegramLink)
        .where(eq(telegramLink.chatId, chatId))
        .limit(1)
    )[0] ?? null
  )
}

export async function listLinks(userId: string): Promise<TelegramLinkRow[]> {
  return db.select().from(telegramLink).where(eq(telegramLink.userId, userId))
}

export async function updateLinkNotify(
  userId: string,
  linkId: string,
  patch: {
    notifyEnabled?: boolean
    notifyScope?: 'all' | 'temp' | 'permanent'
  },
): Promise<TelegramLinkRow | null> {
  const rows = await db
    .update(telegramLink)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(telegramLink.id, linkId), eq(telegramLink.userId, userId)))
    .returning()
  return rows[0] ?? null
}

/** 解绑；传 userId 时限定只能解自己那条 */
export async function unbindChat(
  chatId: string,
  userId?: string,
): Promise<boolean> {
  const rows = await db
    .delete(telegramLink)
    .where(
      userId
        ? and(eq(telegramLink.chatId, chatId), eq(telegramLink.userId, userId))
        : eq(telegramLink.chatId, chatId),
    )
    .returning({ id: telegramLink.id })
  return rows.length > 0
}

export async function unbindLink(
  userId: string,
  linkId: string,
): Promise<boolean> {
  const rows = await db
    .delete(telegramLink)
    .where(and(eq(telegramLink.id, linkId), eq(telegramLink.userId, userId)))
    .returning({ id: telegramLink.id })
  return rows.length > 0
}

export async function touchNotifiedAt(linkId: string) {
  await db
    .update(telegramLink)
    .set({ lastNotifiedAt: new Date() })
    .where(eq(telegramLink.id, linkId))
}
