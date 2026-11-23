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

export async function getSession() {
  const auth = await getAuth()
  return auth.api.getSession({ headers: getRequestHeaders() })
}

/** 跳过 cookieCache，用于管理员权限等不能接受缓存延迟的校验 */
export async function getFreshSession() {
  const auth = await getAuth()
  return auth.api.getSession({
    headers: getRequestHeaders(),
    query: { disableCookieCache: true },
  })
}

export async function requireUser(): Promise<SessionUser> {
  // 不走 cookieCache:封禁、降权、密码重置后要让旧 cookie 立即失效,
  // 不能给被处置账号留下最长 60 秒的读写窗口。
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
    return getRequestHeader('user-agent')
  } catch {
    return undefined
  }
}
