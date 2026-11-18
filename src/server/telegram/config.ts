import '#/server/env'

import { eq } from 'drizzle-orm'

import { db } from '#/db/client'
import { telegramBot } from '#/db/schema'
import { decryptSecret } from '#/server/crypto/secret-box'

export type TelegramBotRow = typeof telegramBot.$inferSelect

const CACHE_TTL = 10_000

let cache: { value: TelegramBotRow | null; at: number } | null = null

/** 单行 Bot 配置；未初始化时返回 null（不做惰性建行，避免无意义的空记录） */
export async function getTelegramBotRow(
  force = false,
): Promise<TelegramBotRow | null> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL) {
    return cache.value
  }

  let row: TelegramBotRow | null = null
  try {
    row =
      (
        await db
          .select()
          .from(telegramBot)
          .where(eq(telegramBot.id, 'default'))
          .limit(1)
      )[0] ?? null
  } catch {
    // 迁移尚未执行时不阻塞启动
    row = null
  }

  cache = { value: row, at: Date.now() }
  return row
}

export interface TelegramRuntime {
  row: TelegramBotRow
  token: string
  webhookSecret: string
  botUsername: string | null
}

/**
 * 运行时配置：只有「启用 + 有 Token」才返回。
 * 解密失败视为未配置，避免一个坏密文把 webhook 路由打挂。
 */
export async function getTelegramRuntime(): Promise<TelegramRuntime | null> {
  const row = await getTelegramBotRow()
  if (!row || !row.enabled || !row.botTokenEnc) return null

  try {
    const token = decryptSecret(row.botTokenEnc)
    if (!token) return null
    return {
      row,
      token,
      webhookSecret: row.webhookSecretEnc
        ? decryptSecret(row.webhookSecretEnc)
        : '',
      botUsername: row.botUsername,
    }
  } catch {
    return null
  }
}

export type TelegramBotPatch = Partial<
  Omit<TelegramBotRow, 'id' | 'updatedAt' | 'updatedBy'>
>

export async function saveTelegramBot(
  patch: TelegramBotPatch,
  updatedBy?: string | null,
): Promise<TelegramBotRow> {
  const values = {
    ...patch,
    updatedAt: new Date(),
    updatedBy: updatedBy ?? null,
  }

  await db
    .insert(telegramBot)
    .values({ id: 'default', ...values })
    .onConflictDoUpdate({ target: telegramBot.id, set: values })

  invalidateTelegramCache()
  const row = await getTelegramBotRow(true)
  if (!row) throw new Error('Telegram 配置写入失败')
  return row
}

/** 只在管理页展示/排障用，失败不抛 */
export async function recordTelegramError(message: string): Promise<void> {
  try {
    await db
      .update(telegramBot)
      .set({
        lastError: message.slice(0, 500),
        lastErrorAt: new Date(),
      })
      .where(eq(telegramBot.id, 'default'))
    invalidateTelegramCache()
  } catch {
    // 记录失败不应影响主流程
  }
}

export function invalidateTelegramCache() {
  cache = null
}
