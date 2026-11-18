import { queryOptions } from '@tanstack/react-query'

import type { Result } from '#/server/errors'
import {
  getQuotaFn,
  listDomainsFn,
  listMailboxesFn,
  listMessagesFn,
} from '#/server/fns/mail'

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    const error = new Error(result.error.message) as Error & { code?: string }
    error.code = result.error.code
    throw error
  }
  return result.data
}

export const mailboxesQuery = queryOptions({
  queryKey: ['mailboxes'],
  queryFn: async () => unwrap(await listMailboxesFn()),
  staleTime: 15_000,
  refetchInterval: 60_000,
})

export const quotaQuery = queryOptions({
  queryKey: ['quota'],
  queryFn: async () => unwrap(await getQuotaFn()),
  staleTime: 10_000,
})

export function messagesQuery(input: {
  mailboxId?: string
  folder: string
  q?: string
}) {
  return queryOptions({
    queryKey: ['messages', input],
    queryFn: async () =>
      unwrap(
        await listMessagesFn({
          data: {
            mailboxId: input.mailboxId,
            folder: input.folder as 'inbox',
            q: input.q,
          },
        }),
      ),
    staleTime: 5_000,
  })
}

export function domainsQuery(kind: 'permanent' | 'temp') {
  return queryOptions({
    queryKey: ['domains', kind],
    queryFn: async () => unwrap(await listDomainsFn({ data: { kind } })),
    staleTime: 60_000,
  })
}

export function formatTime(ms: number): string {
  const date = new Date(ms)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    ...(sameYear ? {} : { year: '2-digit' }),
  })
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function remainingLabel(expiresAt: number | null): string {
  if (!expiresAt) return ''
  const diff = expiresAt - Date.now()
  if (diff <= 0) return '已失效'
  const minutes = Math.floor(diff / 60_000)
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    return `${hours} 小时 ${minutes % 60} 分`
  }
  return `${Math.max(minutes, 1)} 分钟`
}
