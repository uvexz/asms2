import { queryOptions } from '@tanstack/react-query'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import type { Result } from '#/server/errors'
import type { MessageListItem } from '#/server/mail/message'
import { getQuotaFn, listDomainsFn, listMailboxesFn } from '#/server/fns/mail'

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

export function domainsQuery(kind: 'permanent' | 'temp') {
  return queryOptions({
    queryKey: ['domains', kind],
    queryFn: async () => unwrap(await listDomainsFn({ data: { kind } })),
    staleTime: 60_000,
  })
}

export interface MessagePage {
  items: MessageListItem[]
  nextCursor: string | null
}

type MessagePatch = Partial<Pick<MessageListItem, 'isRead' | 'isStarred'>>

/** 局部更新所有邮件列表/详情缓存，避免一次操作触发全部分页重新请求 */
export function patchMessageCaches(
  client: QueryClient,
  id: string,
  patch: MessagePatch,
) {
  client.setQueriesData<InfiniteData<MessagePage>>(
    { queryKey: ['messages'] },
    (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page) => {
          if (!page.items.some((item) => item.id === id)) return page
          return {
            ...page,
            items: page.items.map((item) =>
              item.id === id ? { ...item, ...patch } : item,
            ),
          }
        }),
      }
    },
  )

  client.setQueriesData<MessagePage>(
    { queryKey: ['messages-latest'] },
    (old) => {
      if (!old || !old.items.some((item) => item.id === id)) return old
      return {
        ...old,
        items: old.items.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      }
    },
  )

  client.setQueryData<Record<string, unknown>>(['message', id], (old) =>
    old ? { ...old, ...patch } : old,
  )
}

export function removeMessageFromCaches(client: QueryClient, id: string) {
  client.setQueriesData<InfiniteData<MessagePage>>(
    { queryKey: ['messages'] },
    (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.filter((item) => item.id !== id),
            })),
          }
        : old,
  )

  client.setQueriesData<MessagePage>(
    { queryKey: ['messages-latest'] },
    (old) =>
      old ? { ...old, items: old.items.filter((item) => item.id !== id) } : old,
  )

  client.removeQueries({ queryKey: ['message', id], exact: true })
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
