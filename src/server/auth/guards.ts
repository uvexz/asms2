import {
  getRequestHeader,
  getRequestHeaders,
  getRequestIP,
} from '@tanstack/react-start/server'

import { AppError } from '#/server/errors'
import { isEmailVerificationSatisfied } from '#/server/settings'

import { getAuth } from './index'

export interface SessionUser {
  id: string
  email: string
  name: string
  image?: string | null
  role?: string | null
  banned?: boolean | null
  emailVerified?: boolean | null
  mailboxLimit?: number | null
  sendLimit?: number | null
}

/** 从数据库读取当前最新会话（Better Auth 全局已禁用 cookieCache） */
export async function getFreshSession() {
  const auth = await getAuth()
  return auth.api.getSession({
    headers: getRequestHeaders(),
    query: { disableCookieCache: true },
  })
}

export async function requireUser(): Promise<SessionUser> {
  // 面板服务端函数每次都走 DB 校验：封禁、降权、密码重置后旧 cookie 必须立即失效。
  const session = await getFreshSession().catch(() => null)
  if (!session?.user) {
    throw new AppError('unauthorized', '请先登录', 401)
  }
  const user = session.user as unknown as SessionUser
  if (user.banned) {
    throw new AppError('forbidden', '账号已被停用', 403)
  }
  return user
}

/**
 * 业务入口用这个：站点要求邮箱验证时，未验证账号一律 403。
 * 前端路由的 beforeLoad 跳转只是体验层，真正的拦截必须在服务端。
 */
export async function requireVerifiedUser(): Promise<SessionUser> {
  const user = await requireUser()
  if (await isEmailVerificationSatisfied(user.emailVerified)) return user

  throw new AppError('forbidden', '请先完成邮箱验证', 403)
}

export async function requireAdmin(): Promise<SessionUser> {
  const session = await getFreshSession().catch(() => null)
  if (!session?.user) {
    throw new AppError('unauthorized', '请先登录', 401)
  }
  const user = session.user as unknown as SessionUser
  if (user.banned) {
    throw new AppError('forbidden', '账号已被停用', 403)
  }
  if (user.role !== 'admin') {
    throw new AppError('forbidden', '需要管理员权限', 403)
  }
  return user
}

export function clientIp(): string | undefined {
  try {
    return getRequestIP({ xForwardedFor: true })
  } catch {
    return undefined
  }
}

export function userAgent(): string | undefined {
  try {
    return getRequestHeader('user-agent')?.slice(0, 200) ?? undefined
  } catch {
    return undefined
  }
}
