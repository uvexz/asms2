import { and, eq, or, sql } from 'drizzle-orm'

import { db } from '#/db/client'
import { user } from '#/db/schema'

/**
 * 开启「必须验证邮箱」时，对存量账号的豁免。
 *
 * 只豁免两类：管理员，以及没有密码账号的用户（纯 OAuth / Passkey 登录，
 * 邮箱由 IdP 背书或根本不用邮箱登录）。密码账号一律不代为标记：
 * 否则会绕过 Better Auth「本地邮箱已验证才允许 OAuth 隐式合并」的保护，
 * 有人预先用他人邮箱注册的账号会在对方首次 OAuth 登录时被合并。
 *
 * @returns 被标记为已验证的账号数
 */
export async function exemptExistingUsersFromVerification(): Promise<number> {
  const result = await db
    .update(user)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(
      and(
        eq(user.emailVerified, false),
        or(
          eq(user.role, 'admin'),
          sql`not exists (
            select 1 from account a
            where a.user_id = ${user.id} and a.provider_id = 'credential'
          )`,
        ),
      ),
    )
  return Number(result.rowsAffected)
}
