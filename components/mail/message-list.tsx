import { useEffect, useMemo, useRef } from 'react'
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
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
import { cx } from '@/utils/cx'
import { formatTime, patchMessageCaches, unwrap } from '#/lib/api'
import type { MessagePage } from '#/lib/api'
import { listMessagesFn, updateMessageFn } from '#/server/fns/mail'

const mailRoute = getRouteApi('/mail')

export function MessageList({ selectedId }: { selectedId?: string }) {
  const search = mailRoute.useSearch()
  const navigate = useNavigate({ from: '/mail' })
  const queryClient = useQueryClient()

  const filters = useMemo(
    () => ({
      mailboxId: search.mailboxId,
      folder: search.folder,
      q: search.q,
    }),
    [search.mailboxId, search.folder, search.q],
  )
  const queryKey = useMemo(() => ['messages', filters] as const, [filters])
  const latestKey = useMemo(
    () => ['messages-latest', filters] as const,
    [filters],
  )

  async function fetchPage(cursor?: string) {
    return unwrap(await listMessagesFn({ data: { ...filters, cursor } }))
  }

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 5_000,
  })

  // 定时只刷新首页，避免无限列表把所有已加载分页都重新请求一遍
  const latest = useQuery({
    queryKey: latestKey,
    queryFn: () => fetchPage(),
    enabled: query.isSuccess,
    staleTime: 5_000,
    refetchInterval: 20_000,
  })

  const lastMergedAt = useRef(0)
  useEffect(() => {
    if (!latest.data || !latest.dataUpdatedAt || !query.data) return
    if (latest.dataUpdatedAt <= lastMergedAt.current) return
    lastMergedAt.current = latest.dataUpdatedAt

    queryClient.setQueryData<InfiniteData<MessagePage>>(queryKey, (old) => {
      if (!old || old.pages.length === 0) return old
      return {
        ...old,
        pages: [
          {
            ...old.pages[0],
            items: latest.data.items,
            nextCursor: latest.data.nextCursor,
          },
          ...old.pages.slice(1),
        ],
      }
    })
  }, [latest.data, latest.dataUpdatedAt, query.data, queryClient, queryKey])

  const items = useMemo(() => {
    const seen = new Set<string>()
    const result: MessagePage['items'] = []
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
    <section className="flex w-full shrink-0 flex-col border-e border-separator-border bg-background-primary-default md:w-[380px] lg:w-[420px]">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-separator-border px-4">
        <span className="text-caption-1-semibold text-text-tertiary">
          {items.length} 封邮件
        </span>
        {query.isFetching ? <Spinner className="size-4" /> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
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

        {!query.isLoading && items.length === 0 ? (
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
            <li key={item.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => open(item.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') open(item.id)
                }}
                className={cx(
                  'group flex cursor-pointer flex-col gap-1 border-b border-separator-border px-4 py-3 text-start transition-colors',
                  selectedId === item.id
                    ? 'bg-accent-50'
                    : 'hover:bg-background-secondary-hover',
                )}
              >
                <div className="flex items-center gap-2">
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
                </div>
                <div className="flex items-center gap-2">
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
                  <button
                    type="button"
                    aria-label={item.isStarred ? '取消星标' : '加星标'}
                    onClick={(event) => {
                      event.stopPropagation()
                      void toggleStar(item.id, item.isStarred)
                    }}
                    className="shrink-0 rounded p-0.5 text-foreground-icon-tertiary hover:text-accent-600"
                  >
                    {item.isStarred ? (
                      <RiStarFill
                        className="size-4 text-accent-600"
                        aria-hidden
                      />
                    ) : (
                      <RiStarLine className="size-4" aria-hidden />
                    )}
                  </button>
                </div>
                <p className="line-clamp-1 text-caption-1-regular text-text-tertiary">
                  {item.snippet || '（无正文摘要）'}
                </p>
              </div>
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
