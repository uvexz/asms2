import { eq } from 'drizzle-orm'

import { db } from '#/db/client'
import { user } from '#/db/schema'
import type { SessionUser } from '#/server/auth/guards'
import { getAuth } from '#/server/auth'
import { AppError } from '#/server/errors'

/**
 * 对外 REST API 的鉴权：x-api-key → Better Auth apiKey 插件校验 → 用户。
 * Key 的 metadata.mailboxId 存在时，可在后续限制到单邮箱。
 */
export async function authenticateApiKey(
  request: Request,
): Promise<{ user: SessionUser; mailboxId?: string }> {
  const key =
    request.headers.get('x-api-key') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

  if (!key) {
    throw new AppError('unauthorized', '缺少 x-api-key', 401)
  }

  const auth = await getAuth()
  const result = (await (
    auth.api as unknown as {
      verifyApiKey: (input: {
        body: { key: string }
      }) => Promise<{
        valid?: boolean
        error?: { message?: string }
        key?: { referenceId?: string; metadata?: unknown }
      }>
    }
  ).verifyApiKey({ body: { key } })) as {
    valid?: boolean
    error?: { message?: string }
    key?: { referenceId?: string; metadata?: unknown }
  }

  if (!result?.valid || !result.key?.referenceId) {
    throw new AppError(
      'unauthorized',
      result?.error?.message ?? 'API Key 无效',
      401,
    )
  }

  const row = (
    await db
      .select()
      .from(user)
      .where(eq(user.id, result.key.referenceId))
      .limit(1)
  )[0]

  if (!row || row.banned) {
    throw new AppError('forbidden', '账号不可用', 403)
  }

  let mailboxId: string | undefined
  const metadata = result.key.metadata
  if (metadata && typeof metadata === 'object' && 'mailboxId' in metadata) {
    const value = (metadata as { mailboxId?: unknown }).mailboxId
    if (typeof value === 'string') mailboxId = value
  }

  return {
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      image: row.image,
      role: row.role,
      mailboxLimit: row.mailboxLimit,
      sendLimit: row.sendLimit,
    },
    mailboxId,
  }
}
