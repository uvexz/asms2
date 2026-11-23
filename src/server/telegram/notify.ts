import { and, eq, sql } from 'drizzle-orm'

import { db } from '#/db/client'
import { mailbox, message, messageBody, telegramLink, user } from '#/db/schema'
import { getSiteSettings } from '#/server/settings'
import { sendMessage, TelegramError } from './api'
import type { InlineKeyboard } from './api'
import { getTelegramRuntime, recordTelegramError } from './config'
import { extractVerificationCode, renderInboundNotification } from './format'
import { touchNotifiedAt } from './link'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 入站邮件推送。best-effort：任何失败都只记日志/配置里的 lastError，
 * 绝不影响收件主流程（邮件已经入库，通知只是附加能力）。
 */
export async function notifyInboundMessage(messageId: string): Promise<number> {
  const runtime = await getTelegramRuntime()
  if (!runtime) return 0

  const row = (
    await db
      .select({
        userId: message.userId,
        fromName: message.fromName,
        fromAddress: message.fromAddress,
        subject: message.subject,
        snippet: message.snippet,
        receivedAt: message.receivedAt,
        createdAt: message.createdAt,
        address: mailbox.address,
        kind: mailbox.kind,
        banned: user.banned,
      })
      .from(message)
      .innerJoin(mailbox, eq(mailbox.id, message.mailboxId))
      .innerJoin(user, eq(user.id, message.userId))
      .where(eq(message.id, messageId))
      .limit(1)
  ).at(0)
  // 封禁账号的 Telegram 绑定不会被删除，这里停止推送
  if (!row || row.banned) return 0

  const links = await db
    .select()
    .from(telegramLink)
    .where(
      and(
        eq(telegramLink.userId, row.userId),
        eq(telegramLink.notifyEnabled, true),
      ),
    )

  const matched = links.filter(
    (link) => link.notifyScope === 'all' || link.notifyScope === row.kind,
  )
  if (matched.length === 0) return 0

  const bodyText = (
    await db
      .select({
        text: sql<string>`substr(coalesce(${messageBody.textBody}, ''), 1, 2000)`,
      })
      .from(messageBody)
      .where(eq(messageBody.messageId, messageId))
      .limit(1)
  ).at(0)?.text

  const settings = await getSiteSettings()
  const text = renderInboundNotification({
    kind: row.kind,
    mailboxAddress: row.address,
    fromName: row.fromName,
    fromAddress: row.fromAddress,
    subject: row.subject,
    snippet: row.snippet,
    receivedAt: (row.receivedAt ?? row.createdAt).getTime(),
    timezone: settings.timezone,
    code: extractVerificationCode(row.subject, row.snippet, bodyText),
  })

  const keyboard: InlineKeyboard = [
    [
      { text: '查看正文', callback_data: `d:${messageId}` },
      { text: '标记已读', callback_data: `r:${messageId}` },
    ],
  ]
  const siteUrl = (
    settings.siteUrl ??
    process.env.BETTER_AUTH_URL ??
    ''
  ).replace(/\/$/, '')
  if (siteUrl) {
    keyboard.push([
      { text: '在网页中打开', url: `${siteUrl}/mail/${messageId}` },
    ])
  }

  let sent = 0
  let firstError: string | null = null

  for (const link of matched) {
    const failure = await deliver(runtime.token, link.chatId, text, keyboard)
    if (failure === null) {
      await touchNotifiedAt(link.id)
      sent += 1
      continue
    }

    firstError ??= failure

    // 用户拉黑/删除机器人后 Telegram 返回 403，直接关掉该会话的推送
    if (/blocked|chat not found|user is deactivated/i.test(failure)) {
      await db
        .update(telegramLink)
        .set({ notifyEnabled: false, updatedAt: new Date() })
        .where(eq(telegramLink.id, link.id))
        .catch(() => undefined)
    }
  }

  if (firstError) {
    console.error('[telegram] notify failed:', firstError)
    await recordTelegramError(`推送失败：${firstError}`)
  }

  return sent
}

/** 发送一条推送；成功返回 null，失败返回错误描述（429 且等待短时重试一次） */
async function deliver(
  token: string,
  chatId: string,
  text: string,
  keyboard: InlineKeyboard,
): Promise<string | null> {
  try {
    await sendMessage(token, { chatId, text, keyboard })
    return null
  } catch (error) {
    let failure: unknown = error

    if (
      failure instanceof TelegramError &&
      failure.code === 'rate_limited' &&
      (failure.retryAfter ?? 0) <= 3
    ) {
      await sleep((failure.retryAfter ?? 1) * 1000)
      try {
        await sendMessage(token, { chatId, text, keyboard })
        return null
      } catch (retryError) {
        failure = retryError
      }
    }

    return failure instanceof Error ? failure.message : 'Telegram 推送失败'
  }
}
