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
  mailboxLimit?: number | null
  sendLimit?: number | null
}

export async function getSession() {
  const auth = await getAuth()
  return auth.api.getSession({ headers: getRequestHeaders() })
}

export async function requireUser(): Promise<SessionUser> {
  const session = await getSession().catch(() => null)
  if (!session?.user) {
    throw new AppError('unauthorized', '请先登录', 401)
  }
  return session.user as unknown as SessionUser
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser()
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
