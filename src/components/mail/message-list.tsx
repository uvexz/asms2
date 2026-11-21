import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import {
  RiAttachment2,
  RiInboxLine,
  RiStarFill,
  RiStarLine,
} from '@remixicon/react'

import { Button } from '#/components/base/buttons/button'
import { Skeleton } from '#/components/base/skeleton/skeleton'
import { Spinner } from '#/components/base/spinner/spinner'
import { toast } from '#/components/base/toast/toast'
import { ErrorState } from '#/components/application/errors/error-state'
import { cx } from '#/utils/cx'
import {
  formatTime,
  messageQuery,
  messagesInfiniteQuery,
  noteMessageWrite,
  patchMessageCaches,
  refreshMessageFirstPage,
  unwrap,
} from '#/lib/api'
import { updateMessageFn } from '#/server/fns/mail'

import { subscribeMailRefresh } from './refresh-bus'

const mailRoute = getRouteApi('/mail')

const POLL_INTERVAL = 20_000

export function MessageList({ selectedId }: { selectedId?: string }) {
  const search = mailRoute.useSearch()
  const navigate = useNavigate({ from: '/mail' })
  const queryClient = useQueryClient()
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastRefreshRef = useRef(0)

  const filters = useMemo(
    () => ({
      mailboxId: search.mailboxId,
      folder: search.folder,
      q: search.q,
    }),
    [search.mailboxId, search.folder, search.q],
  )

  const query = useInfiniteQuery(messagesInfiniteQuery(filters))

  // 只重取首页：定时轮询和手动刷新都不再触碰已加载的后续分页
  const refreshFirstPage = useCallback(async () => {
    const now = Date.now()
    // 轮询、手动刷新、切回标签页可能在同一秒内撞在一起，5s 内只放一次
    if (now - lastRefreshRef.current < 5_000) return
    lastRefreshRef.current = now
    try {
      await refreshMessageFirstPage(queryClient, filters)
    } catch {
      // 轮询失败不打扰用户；列表自身的错误态与重试按钮负责显式失败
    }
  }, [filters, queryClient])

  useEffect(
    () => subscribeMailRefresh(() => void refreshFirstPage()),
    [refreshFirstPage],
  )

  useEffect(() => {
    if (!query.isSuccess) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void refreshFirstPage()
    }, POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [query.isSuccess, refreshFirstPage])

  // 首次进入某个筛选条件时，若缓存已经过期就先补一次首页：
  // 挂载时不再重取全部分页，但也不该让人对着旧列表等满一个轮询周期。
  const refreshedForFilters = useRef('')
  useEffect(() => {
    if (!query.isSuccess) return
    const key = `${filters.folder}|${filters.mailboxId ?? ''}|${filters.q ?? ''}`
    if (refreshedForFilters.current === key) return
    refreshedForFilters.current = key
    if (Date.now() - query.dataUpdatedAt > POLL_INTERVAL) {
      void refreshFirstPage()
    }
  }, [query.isSuccess, query.dataUpdatedAt, filters, refreshFirstPage])

  // 聚焦刷新全局关闭、轮询在隐藏标签页暂停，切回来必须主动补一次
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void refreshFirstPage()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [refreshFirstPage])

  // 切换筛选条件后回到顶部，避免停留在上一个列表的滚动位置
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [filters.folder, filters.mailboxId, filters.q])

  const items = useMemo(() => {
    const seen = new Set<string>()
    const result: NonNullable<typeof query.data>['pages'][number]['items'] = []
    for (const page of query.data?.pages ?? []) {
      for (const item of page.items) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        result.push(item)
      }
    }
    return result
  }, [query.data])

  const starMutation = useMutation({
    mutationFn: async (input: { id: string; isStarred: boolean }) =>
      unwrap(await updateMessageFn({ data: input })),
    onMutate: (input) => {
      // 记下写入时刻：20s 轮询拿的是请求发出时的快照，不能把它盖回旧值
      noteMessageWrite(input.id)
      patchMessageCaches(queryClient, input.id, { isStarred: input.isStarred })
    },
    onError: (error: Error, input) => {
      patchMessageCaches(queryClient, input.id, { isStarred: !input.isStarred })
      toast.error(error.message)
    },
  })

  function toggleStar(id: string, starred: boolean) {
    const pendingSameRow =
      starMutation.isPending && starMutation.variables.id === id
    if (pendingSameRow) return
    starMutation.mutate({ id, isStarred: !starred })
  }

  /** 悬停/聚焦时预取详情，点进阅读器不再有一次空白 spinner */
  function prefetch(id: string) {
    void queryClient.prefetchQuery(messageQuery(id))
  }

  function open(id: string) {
    void navigate({
      to: '/mail/$messageId',
      params: { messageId: id },
      search: (prev) => ({ ...prev }),
    })
  }

  return (
    <section
      className={cx(
        'w-full shrink-0 flex-col border-e border-separator-border bg-background-primary-default md:flex md:w-[380px] lg:w-[420px]',
        // 手机端列表与阅读二选一：选中邮件时让位给阅读器
        selectedId ? 'hidden md:flex' : 'flex',
      )}
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-separator-border px-4">
        <span className="text-caption-1-semibold text-text-tertiary">
          {query.isError ? '加载失败' : `${items.length} 封邮件`}
        </span>
        {query.isFetching && !query.isLoading ? (
          <Spinner className="size-4" />
        ) : null}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {query.isError ? (
          <ErrorState
            compact
            title="邮件列表加载失败"
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : null}

        {query.isLoading ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : null}

        {!query.isLoading && !query.isError && items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <RiInboxLine
              className="size-10 text-foreground-icon-quaternary"
              aria-hidden
            />
            <p className="text-body-medium text-text-secondary">
              这里还没有邮件
            </p>
            <p className="text-caption-1-regular text-text-tertiary">
              {search.q
                ? '换个关键词试试'
                : search.folder === 'sent'
                  ? '发出的邮件会显示在这里'
                  : '收到的新邮件会自动出现在这里'}
            </p>
          </div>
        ) : null}

        <ul>
          {items.map((item) => (
            <li
              key={item.id}
              className="group relative border-b border-separator-border"
            >
              <button
                type="button"
                onClick={() => open(item.id)}
                onMouseEnter={() => prefetch(item.id)}
                onFocus={() => prefetch(item.id)}
                aria-current={selectedId === item.id ? 'true' : undefined}
                className={cx(
                  'flex w-full cursor-pointer flex-col gap-1 px-4 py-3 text-start transition-colors',
                  'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring',
                  selectedId === item.id
                    ? 'bg-accent-50'
                    : 'hover:bg-background-secondary-hover',
                )}
              >
                <span className="flex items-center gap-2 pe-6">
                  <span
                    className={cx(
                      'min-w-0 flex-1 truncate text-body-medium',
                      item.isRead
                        ? 'text-text-secondary'
                        : 'font-semibold text-text-primary',
                    )}
                  >
                    {item.direction === 'outbound'
                      ? `发给 ${item.to[0] ?? '（无收件人）'}`
                      : item.fromName || item.fromAddress}
                  </span>
                  <span className="shrink-0 text-caption-1-regular text-text-tertiary">
                    {formatTime(item.receivedAt)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className={cx(
                      'min-w-0 flex-1 truncate text-body-regular',
                      item.isRead ? 'text-text-secondary' : 'text-text-primary',
                    )}
                  >
                    {item.subject || '(无主题)'}
                  </span>
                  {item.hasAttachments ? (
                    <RiAttachment2
                      className="size-3.5 shrink-0 text-foreground-icon-quaternary"
                      aria-hidden
                    />
                  ) : null}
                </span>
                <span className="line-clamp-1 text-caption-1-regular text-text-tertiary">
                  {item.snippet || '（无正文摘要）'}
                </span>
              </button>

              {/* 星标放在按钮外，避免交互控件嵌套 */}
              <button
                type="button"
                aria-label={item.isStarred ? '取消星标' : '加星标'}
                aria-pressed={item.isStarred}
                disabled={
                  starMutation.isPending &&
                  starMutation.variables.id === item.id
                }
                onClick={() => toggleStar(item.id, item.isStarred)}
                className="absolute end-1.5 top-2 grid size-6 place-items-center rounded-md text-foreground-icon-tertiary outline-none transition-colors hover:text-accent-600 focus-visible:ring-2 focus-visible:ring-border-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {item.isStarred ? (
                  <RiStarFill className="size-4 text-accent-600" aria-hidden />
                ) : (
                  <RiStarLine className="size-4" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>

        {query.hasNextPage ? (
          <div className="flex justify-center p-4">
            <Button
              variant="secondary"
              size="small"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              加载更早的邮件
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
