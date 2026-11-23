import { createServerFn } from '@tanstack/react-start'
import { and, eq, sql } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'
import { z } from 'zod'

import { db } from '#/db/client'
import { account, auditLog, authProvider, passkey } from '#/db/schema'
import { clientIp, requireUser, userAgent } from '#/server/auth/guards'
import { accountKind, accountLabel } from '#/server/auth/provider-labels'
import type { LoginAccountKind } from '#/server/auth/provider-labels'
import { AppError, attempt } from '#/server/errors'

const idPart = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 20)

export interface SsoAccountView {
  /** `account.id`，解绑时按它定位 */
  id: string
  providerId: string
  label: string
  kind: LoginAccountKind
  linkedAt: number
  /** 管理员已停用该登录方式；仍可解绑，但不能再用来登录 */
  enabled: boolean
  /** 邮箱密码不在这里解绑；解绑后至少要剩一种登录方式 */
  removable: boolean
}

export interface SsoBindOption {
  providerId: string
  label: string
  kind: LoginAccountKind
}

async function countPasskeys(userId: string) {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(passkey)
    .where(eq(passkey.userId, userId))
  return Number(rows[0]?.count ?? 0)
}

/** 当前用户已绑定的登录账号 + 还能绑定的第三方登录方式 */
export const listSsoAccountsFn = createServerFn({ method: 'GET' }).handler(
  async () =>
    attempt(async () => {
      const user = await requireUser()
      const [rows, providers, passkeyCount] = await Promise.all([
        db
          .select({
            id: account.id,
            providerId: account.providerId,
            createdAt: account.createdAt,
          })
          .from(account)
          .where(eq(account.userId, user.id))
          .orderBy(account.createdAt),
        db
          .select({
            providerId: authProvider.providerId,
            displayName: authProvider.displayName,
            kind: authProvider.kind,
            enabled: authProvider.enabled,
          })
          .from(authProvider)
          .orderBy(authProvider.sortOrder, authProvider.createdAt),
        countPasskeys(user.id),
      ])

      const providerById = new Map(
        providers.map((row) => [row.providerId, row]),
      )
      // 登录方式总数 = account 行 + Passkey；解绑后不能归零
      const totalMethods = rows.length + passkeyCount

      const accounts: SsoAccountView[] = rows.map((row) => {
        // credential 对应 auth_provider 里的 email 行
        const provider =
          providerById.get(row.providerId) ??
          (row.providerId === 'credential'
            ? providerById.get('email')
            : undefined)
        return {
          id: row.id,
          providerId: row.providerId,
          label: accountLabel(row.providerId, provider?.displayName),
          kind: accountKind(row.providerId, provider?.kind),
          linkedAt: row.createdAt.getTime(),
          // 认证方式被管理员删除后，account 行仍在，只是不能再用来登录
          enabled: provider ? Boolean(provider.enabled) : false,
          removable: row.providerId !== 'credential' && totalMethods > 1,
        }
      })

      const linked = new Set(rows.map((row) => row.providerId))
      const bindable: SsoBindOption[] = providers
        .filter(
          (row) =>
            row.enabled &&
            row.kind !== 'email' &&
            row.kind !== 'passkey' &&
            !linked.has(row.providerId),
        )
        .map((row) => ({
          providerId: row.providerId,
          label: accountLabel(row.providerId, row.displayName),
          kind: accountKind(row.providerId, row.kind),
        }))

      return { accounts, bindable, passkeyCount }
    }),
)

/** 解绑第三方账号；不允许解掉最后一种登录方式 */
export const unlinkSsoAccountFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z.object({ accountId: z.string().min(1).max(64) }).parse(data),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      const user = await requireUser()
      const rows = await db
        .select({ id: account.id, providerId: account.providerId })
        .from(account)
        .where(eq(account.userId, user.id))

      const target = rows.find((row) => row.id === data.accountId)
      if (!target) throw new AppError('not_found', '账号不存在', 404)
      if (target.providerId === 'credential') {
        throw new AppError('validation_failed', '邮箱密码不能在这里解绑')
      }

      const passkeyCount = await countPasskeys(user.id)
      if (rows.length - 1 + passkeyCount < 1) {
        throw new AppError(
          'conflict',
          '至少保留一种登录方式，请先绑定其他账号或添加 Passkey',
        )
      }

      // 带上 userId 兜底：即使 id 猜对也不能动别人的账号
      await db
        .delete(account)
        .where(and(eq(account.id, target.id), eq(account.userId, user.id)))

      await db.insert(auditLog).values({
        id: idPart(),
        actorUserId: user.id,
        actorRole: user.role ?? 'user',
        action: 'account.unlink',
        targetType: 'account',
        targetId: target.id,
        metaJson: JSON.stringify({ providerId: target.providerId }),
        ip: clientIp(),
        userAgent: userAgent(),
        createdAt: new Date(),
      })

      return { id: target.id }
    }),
  )
