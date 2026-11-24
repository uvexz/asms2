import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import type { ErrorCode, Result } from '#/server/errors'
import type { MailboxView } from '#/server/mail/mailbox'
import type { MessageListItem } from '#/server/mail/message'
import {
  getMessageFn,
  getQuotaFn,
  listDomainsFn,
  listMailboxesFn,
  listMessagesFn,
} from '#/server/fns/mail'
import { getPublicLoginConfigFn, getSessionFn } from '#/server/fns/site'

import { MAILBOX_LIST_LIMIT } from '#/lib/limits'
import { queryKeys } from '#/lib/query-keys'
import type { MailFolder, MessageListFilters } from '#/lib/query-keys'

export type { MailFolder, MessageListFilters }

export function unwrapError(error: { code: ErrorCode; message: string }) {
  const wrapped = new Error(error.message) as Error & { code?: string }
  wrapped.code = error.code
  return wrapped
}

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw unwrapError(result.error)
  return result.data
}

/** 会话走 query 缓存：路由 beforeLoad 每次导航都会跑，但不该每次都发 RPC */
export const sessionQuery = queryOptions({
  queryKey: queryKeys.session,
  queryFn: () => getSessionFn(),
  // 30s 缓存拦截 Link hover 意图预取与高频切页 RPC；登出、修改密码、降权时由前端主动 invalidate 驱动刷新
  staleTime: 30_000,
})

/** 登录方式配置只给登录/注册/设置页用，不再塞进根 loader */
export const loginConfigQuery = queryOptions({
  queryKey: queryKeys.publicLoginConfig,
  queryFn: () => getPublicLoginConfigFn(),
  staleTime: 60_000,
})

export const mailboxesQuery = queryOptions({
  queryKey: queryKeys.mailboxes,
  queryFn: async () => unwrap(await listMailboxesFn()),
  staleTime: 15_000,
  refetchInterval: 60_000,
})

/** 侧栏用无限分页:临时邮箱不设总量上限,不能只显示前 200 个。 */
export function mailboxesInfiniteQuery() {
  return infiniteQueryOptions({
    queryKey: [...queryKeys.mailboxes, 'pages'] as const,
    queryFn: async ({ pageParam }) =>
      unwrap(await listMailboxesFn({ data: { offset: pageParam } })),
    initialPageParam: 0,
    getNextPageParam: (last, all) =>
      last.length === MAILBOX_LIST_LIMIT
        ? all.length * MAILBOX_LIST_LIMIT
        : undefined,
    staleTime: 15_000,
    refetchInterval: 60_000,
  })
}

export const quotaQuery = queryOptions({
  queryKey: queryKeys.quota,
  queryFn: async () => unwrap(await getQuotaFn()),
  staleTime: 10_000,
})

export function domainsQuery(kind: 'permanent' | 'temp') {
  return queryOptions({
    queryKey: queryKeys.domains(kind),
    queryFn: async () => unwrap(await listDomainsFn({ data: { kind } })),
    staleTime: 60_000,
  })
}

export interface MessagePage {
  items: MessageListItem[]
  nextCursor: string | null
}

export function messageQuery(messageId: string) {
  return queryOptions({
    queryKey: queryKeys.message.detail(messageId),
    queryFn: async () =>
      unwrap(await getMessageFn({ data: { id: messageId } })),
    staleTime: 30_000,
  })
}

/** 列表的唯一数据源：组件与路由 loader 共用同一份 query key/参数 */
export function messagesInfiniteQuery(filters: MessageListFilters) {
  return infiniteQueryOptions({
    queryKey: queryKeys.messages.list(filters),
    queryFn: async ({ pageParam }) =>
      unwrap(await listMessagesFn({ data: { ...filters, cursor: pageParam } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    /**
     * 新鲜度由 20s 轮询负责（它只刷新首页）。
     * infinite query 的 refetch 语义是"把已加载的每一页从头串行重取一遍"，
     * staleTime 设成 5s 会让每次重新挂载/再次导航都变成 N 次 RPC。
     */
    staleTime: 20_000,
    refetchOnMount: false,
  })
}

export async function fetchMessageFirstPage(filters: MessageListFilters) {
  return unwrap(await listMessagesFn({ data: { ...filters } }))
}

/**
 * 本地写操作（星标/已读）的时间戳。
 *
 * 轮询拿到的是"请求发出那一刻"的快照：写入发生在请求发出之后时，响应回来会把
 * 新值盖回旧值。这里记下写入时刻，合并首页时保住晚于 `since` 的本地结果，
 * 等下一轮轮询自然收敛（服务端已经是新值）。
 */
const localWrites = new Map<string, number>()
const LOCAL_WRITE_TTL = 60_000

export function noteMessageWrite(id: string) {
  const now = Date.now()
  localWrites.set(id, now)

  if (localWrites.size > 200) {
    const cutoff = now - LOCAL_WRITE_TTL
    for (const [key, at] of localWrites) {
      if (at < cutoff) localWrites.delete(key)
    }
  }
}

function locallyWrittenSince(id: string, since: number) {
  const at = localWrites.get(id)
  return at !== undefined && at > since
}

export interface MergeMessagePageOptions {
  /** 刷新请求发出的时刻；晚于它发生的本地写不会被覆盖 */
  since?: number
}

/**
 * 把刷新结果并回无限列表。
 *
 * 只有一页时整页替换；已加载多页时**不能**动第一页的 `nextCursor`——它是第 2 页的
 * 起点，改了就会出现"新邮件到达后有一封从列表消失"的空洞。多页场景只把新到达的
 * 邮件并到前面，并保留旧边界之外的尾部，避免漏信。
 */
export function mergeMessageFirstPage(
  client: QueryClient,
  filters: MessageListFilters,
  page: MessagePage,
  options: MergeMessagePageOptions = {},
) {
  const since = options.since ?? Date.now()

  client.setQueryData<InfiniteData<MessagePage>>(
    queryKeys.messages.list(filters),
    (old) => {
      // 首屏还没落地就收到刷新结果：直接种进去，别把已经取回的数据丢掉
      if (!old || old.pages.length === 0) {
        return { pages: [page], pageParams: [undefined] }
      }

      const previous = new Map(
        old.pages[0].items.map((item) => [item.id, item]),
      )

      const keepLocal = (item: MessageListItem): MessageListItem => {
        if (!locallyWrittenSince(item.id, since)) return item
        const prev = previous.get(item.id)
        return prev
          ? { ...item, isRead: prev.isRead, isStarred: prev.isStarred }
          : item
      }

      const items = page.items.map(keepLocal)

      // 单页：没有跨页边界，整页替换是安全且最准确的
      if (old.pages.length === 1) {
        return {
          ...old,
          pages: [{ ...old.pages[0], items, nextCursor: page.nextCursor }],
        }
      }

      const freshIds = new Set(items.map((item) => item.id))
      const bottom = items.at(-1)?.receivedAt ?? Number.POSITIVE_INFINITY
      const tail = old.pages[0].items.filter(
        (item) => !freshIds.has(item.id) && item.receivedAt < bottom,
      )

      return {
        ...old,
        pages: [
          { ...old.pages[0], items: [...items, ...tail] },
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
  const since = Date.now()
  const page = await fetchMessageFirstPage(filters)
  mergeMessageFirstPage(client, filters, page, { since })
  return page
}

/** 未读数是服务端算好的绝对值；用 delta 会在连点/重试/跨端时漂移 */
export function setMailboxUnread(
  client: QueryClient,
  mailboxId: string,
  unreadCount: number,
) {
  // 1. 同步更新普通列表缓存
  client.setQueryData<MailboxView[]>(queryKeys.mailboxes, (old) =>
    old
      ? old.map((item) =>
          item.id === mailboxId ? { ...item, unreadCount } : item,
        )
      : old,
  )

  // 2. 同步更新侧栏使用的无限分页缓存，使侧栏未读徽标与总未读即时刷新
  client.setQueryData<InfiniteData<MailboxView[]>>(
    [...queryKeys.mailboxes, 'pages'],
    (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page) =>
          page.map((item) =>
            item.id === mailboxId ? { ...item, unreadCount } : item,
          ),
        ),
      }
    },
  )
}

/** 删除邮箱后把它的邮件从所有列表/详情缓存里摘掉，并清理邮箱缓存 */
export function removeMailboxFromCaches(
  client: QueryClient,
  mailboxId: string,
) {
  // 从普通列表与侧栏无限列表摘除该邮箱
  client.setQueryData<MailboxView[]>(queryKeys.mailboxes, (old) =>
    old ? old.filter((item) => item.id !== mailboxId) : old,
  )
  client.setQueryData<InfiniteData<MailboxView[]>>(
    [...queryKeys.mailboxes, 'pages'],
    (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((page) =>
              page.filter((item) => item.id !== mailboxId),
            ),
          }
        : old,
  )

  client.setQueriesData<InfiniteData<MessagePage>>(
    { queryKey: queryKeys.messages.all },
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

  client.removeQueries({
    predicate: (query) =>
      query.queryKey[0] === queryKeys.message.all[0] &&
      (query.state.data as { mailboxId?: string } | undefined)?.mailboxId ===
        mailboxId,
  })
}

type MessageDetail = Exclude<
  Awaited<ReturnType<typeof getMessageFn>>,
  { ok: false }
>['data']

type MessagePatch = Partial<Pick<MessageListItem, 'isRead' | 'isStarred'>>

/** 局部更新所有邮件列表/详情缓存，避免一次操作触发全部分页重新请求 */
export function patchMessageCaches(
  client: QueryClient,
  id: string,
  patch: MessagePatch,
) {
  client.setQueriesData<InfiniteData<MessagePage>>(
    { queryKey: queryKeys.messages.all },
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

  client.setQueryData<MessageDetail>(queryKeys.message.detail(id), (old) =>
    old ? { ...old, ...patch } : old,
  )
}

export function removeMessageFromCaches(client: QueryClient, id: string) {
  client.setQueriesData<InfiniteData<MessagePage>>(
    { queryKey: queryKeys.messages.all },
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

  client.removeQueries({ queryKey: queryKeys.message.detail(id), exact: true })
}

/**
 * 退出 / 切换账号时清空用户态缓存。
 * 公开登录配置与账号无关，留着可以省掉登录后的一次重复请求。
 */
export function clearUserCaches(client: QueryClient) {
  client.removeQueries({
    predicate: (query) => query.queryKey[0] !== queryKeys.publicLoginConfig[0],
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
