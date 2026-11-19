import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import {
  RiAttachment2,
  RiInboxLine,
  RiStarFill,
  RiStarLine,
} from '@remixicon/react'

import { Button } from '@/components/base/buttons/button'
import { Skeleton } from '@/components/base/skeleton/skeleton'
import { Spinner } from '@/components/base/spinner/spinner'
import { toast } from '@/components/base/toast/toast'
import { ErrorState } from '@/components/application/errors/error-state'
import { cx } from '@/utils/cx'
import {
  formatTime,
  messagesInfiniteQuery,
  patchMessageCaches,
  refreshMessageFirstPage,
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

  async function toggleStar(id: string, starred: boolean) {
    const next = !starred
    patchMessageCaches(queryClient, id, { isStarred: next })
    const result = await updateMessageFn({
      data: { id, isStarred: next },
    })
    if (!result.ok) {
      patchMessageCaches(queryClient, id, { isStarred: starred })
      toast.error(result.error.message)
    }
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
                onClick={() => void toggleStar(item.id, item.isStarred)}
                className="absolute end-1.5 top-2 grid size-6 place-items-center rounded-md text-foreground-icon-tertiary outline-none transition-colors hover:text-accent-600 focus-visible:ring-2 focus-visible:ring-border-focus-ring"
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
