import {
  getRequestHeader,
  getRequestHeaders,
  getRequestIP,
} from '@tanstack/react-start/server'

import { AppError } from '#/server/errors'

import { getAuth } from './index'

export interface SessionUser {
  id: string
  email: string
  name: string
  image?: string | null
  role?: string | null
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
  const session = await getSession().catch(() => null)
  if (!session?.user) {
    throw new AppError('unauthorized', '请先登录', 401)
  }
  return session.user
}

export async function requireAdmin(): Promise<SessionUser> {
  const session = await getFreshSession().catch(() => null)
  if (!session?.user) {
    throw new AppError('unauthorized', '请先登录', 401)
  }
  const user = session.user as unknown as SessionUser
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
