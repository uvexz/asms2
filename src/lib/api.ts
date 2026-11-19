import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import type { Result } from '#/server/errors'
import type { MailboxView } from '#/server/mail/mailbox'
import type { MessageListItem } from '#/server/mail/message'
import {
  getQuotaFn,
  listDomainsFn,
  listMailboxesFn,
  listMessagesFn,
} from '#/server/fns/mail'
import { getPublicLoginConfigFn, getSessionFn } from '#/server/fns/site'

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    const error = new Error(result.error.message) as Error & { code?: string }
    error.code = result.error.code
    throw error
  }
  return result.data
}

/** 会话走 query 缓存：路由 beforeLoad 每次导航都会跑，但不该每次都发 RPC */
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: () => getSessionFn(),
  staleTime: 30_000,
})

/** 登录方式配置只给登录/注册/设置页用，不再塞进根 loader */
export const loginConfigQuery = queryOptions({
  queryKey: ['public-login-config'],
  queryFn: () => getPublicLoginConfigFn(),
  staleTime: 60_000,
})

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

export type MailFolder = 'inbox' | 'sent' | 'trash' | 'spam' | 'archive'

export interface MessageListFilters {
  mailboxId?: string
  folder: MailFolder
  q?: string
}

/** 列表的唯一数据源：组件与路由 loader 共用同一份 query key/参数 */
export function messagesInfiniteQuery(filters: MessageListFilters) {
  return infiniteQueryOptions({
    queryKey: ['messages', filters] as const,
    queryFn: async ({ pageParam }) =>
      unwrap(await listMessagesFn({ data: { ...filters, cursor: pageParam } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 5_000,
  })
}

export async function fetchMessageFirstPage(filters: MessageListFilters) {
  return unwrap(await listMessagesFn({ data: { ...filters } }))
}

/** 只替换第一页，保留已加载的后续分页（不会把 N 页全部重取） */
export function mergeMessageFirstPage(
  client: QueryClient,
  filters: MessageListFilters,
  page: MessagePage,
) {
  client.setQueryData<InfiniteData<MessagePage>>(
    ['messages', filters],
    (old) => {
      if (!old || old.pages.length === 0) return old
      return {
        ...old,
        pages: [
          {
            ...old.pages[0],
            items: page.items,
            nextCursor: page.nextCursor,
          },
          ...old.pages.slice(1),
        ],
      }
    },
  )
}

export async function refreshMessageFirstPage(
  client: QueryClient,
  filters: MessageListFilters,
) {
  const page = await fetchMessageFirstPage(filters)
  mergeMessageFirstPage(client, filters, page)
  return page
} /** 已读/未读变化直接改计数，避免整张邮箱列表 + 未读聚合重查 */
export function patchMailboxUnread(
  client: QueryClient,
  mailboxId: string,
  delta: number,
) {
  client.setQueriesData<MailboxView[]>({ queryKey: ['mailboxes'] }, (old) =>
    old
      ? old.map((item) =>
          item.id === mailboxId
            ? {
                ...item,
                unreadCount: Math.max(0, item.unreadCount + delta),
              }
            : item,
        )
      : old,
  )
}

/** 删除邮箱后把它的邮件从所有列表/详情缓存里摘掉 */
export function removeMailboxFromCaches(
  client: QueryClient,
  mailboxId: string,
) {
  client.setQueriesData<InfiniteData<MessagePage>>(
    { queryKey: ['messages'] },
    (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.filter((item) => item.mailboxId !== mailboxId),
            })),
          }
        : old,
  )

  client.setQueriesData<MessagePage>(
    { queryKey: ['messages-latest'] },
    (old) =>
      old
        ? {
            ...old,
            items: old.items.filter((item) => item.mailboxId !== mailboxId),
          }
        : old,
  )

  client.removeQueries({
    predicate: (query) =>
      query.queryKey[0] === 'message' &&
      (query.state.data as { mailboxId?: string } | undefined)?.mailboxId ===
        mailboxId,
  })
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
