import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  RiAddLine,
  RiArchiveLine,
  RiArrowDownSLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiInboxLine,
  RiMailLine,
  RiMailSendLine,
  RiRefreshLine,
  RiSearchLine,
  RiSpam2Line,
  RiTimeLine,
} from '@remixicon/react'

import { Counter } from '#/components/base/badges/counter'
import { Button } from '#/components/base/buttons/button'
import { IconButton } from '#/components/base/buttons/icon-button'
import {
  Dropdown,
  DropdownDivider,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from '#/components/base/dropdown/dropdown'
import { Input } from '#/components/base/input/input'
import { AlertDialog } from '#/components/base/modal/modal'
import { Spinner } from '#/components/base/spinner/spinner'
import { ThemeToggle } from '#/components/application/theme/theme-toggle'
import { ErrorState } from '#/components/application/errors/error-state'
import { toast } from '#/components/base/toast/toast'
import { AppShell } from '#/components/shell/app-shell'
import {
  ScrollFade,
  useScrollFade,
} from '#/components/foundations/scroll-fade/scroll-fade'
import {
  SidebarAccount,
  SidebarNav,
  SidebarNavButton,
} from '#/components/shell/sidebar'
import {
  mailboxesInfiniteQuery,
  quotaQuery,
  remainingLabel,
  removeMailboxFromCaches,
} from '#/lib/api'
import { queryKeys } from '#/lib/query-keys'
import type { MailboxView } from '#/server/mail/mailbox'
import { removeMailboxFn } from '#/server/fns/mail'

import { ComposeModal } from './compose-modal'
import { ComposeContext } from './compose-context'
import type { ComposeOptions } from './compose-context'
import { CreateMailboxModal } from './create-mailbox-modal'
import { requestMailRefresh } from './refresh-bus'

const mailRoute = getRouteApi('/mail')
const rootApi = getRouteApi('__root__')

const FOLDERS = [
  { key: 'inbox', label: '收件箱', icon: RiInboxLine },
  { key: 'sent', label: '已发送', icon: RiMailSendLine },
  { key: 'archive', label: '归档', icon: RiArchiveLine },
  { key: 'spam', label: '垃圾邮件', icon: RiSpam2Line },
  { key: 'trash', label: '回收站', icon: RiDeleteBinLine },
] as const

function RailContent({
  mailboxes,
  loading,
  error,
  onRetry,
  onCompose,
  onCreate,
  onNavigate,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  mailboxes: MailboxView[]
  loading: boolean
  error: unknown
  onRetry: () => void
  onCompose: () => void
  onCreate: () => void
  onNavigate?: () => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
}) {
  const search = mailRoute.useSearch()
  const navigate = useNavigate({ from: '/mail' })
  const queryClient = useQueryClient()
  const quota = useQuery(quotaQuery)
  const fade = useScrollFade()
  const [deleting, setDeleting] = useState<MailboxView | null>(null)

  const permanent = mailboxes.filter((item) => item.kind === 'permanent')
  const temp = mailboxes.filter((item) => item.kind === 'temp')
  const selected = search.mailboxId
    ? mailboxes.find((item) => item.id === search.mailboxId)
    : undefined
  // 选中单个邮箱时，收件箱徽标显示该邮箱的未读，而不是全局总和
  const totalUnread = selected
    ? selected.unreadCount
    : mailboxes.reduce((sum, item) => sum + item.unreadCount, 0)

  function select(patch: Record<string, unknown>) {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
    onNavigate?.()
  }

  async function copy(address: string) {
    await navigator.clipboard.writeText(address)
    toast.success('地址已复制')
  }

  async function remove() {
    if (!deleting) return
    const result = await removeMailboxFn({ data: { id: deleting.id } })
    if (!result.ok) {
      toast.error(result.error.message)
      throw new Error(result.error.message)
    }
    toast.success('邮箱已删除')
    if (search.mailboxId === deleting.id) {
      select({ mailboxId: undefined, messageId: undefined })
    }
    removeMailboxFromCaches(queryClient, deleting.id)
    setDeleting(null)
    void queryClient.invalidateQueries({ queryKey: queryKeys.quota })
    // 当前列表可能包含该邮箱的邮件，刷新首页把它们去掉
    requestMailRefresh()
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <SidebarAccount />

      <Button className="w-full" leadingIcon={RiAddLine} onClick={onCompose}>
        写信
      </Button>

      <SidebarNav>
        {FOLDERS.map((folder) => (
          <SidebarNavButton
            key={folder.key}
            icon={folder.icon}
            label={folder.label}
            active={search.folder === folder.key}
            onClick={() => select({ folder: folder.key, messageId: undefined })}
            trailing={
              folder.key === 'inbox' && totalUnread > 0 ? (
                <Counter color="primary">{totalUnread}</Counter>
              ) : null
            }
          />
        ))}
      </SidebarNav>

      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-caption-1-semibold text-text-tertiary">
          我的邮箱
        </span>
        <IconButton
          size="small"
          icon={RiAddLine}
          aria-label="新建邮箱"
          onClick={onCreate}
        />
      </div>

      <div className="relative min-h-0 flex-1">
        <div onScroll={fade.onScroll} className="h-full overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-6">
              <Spinner className="size-5" />
            </div>
          ) : null}

          {error ? (
            <ErrorState
              compact
              error={error}
              onRetry={onRetry}
              className="px-1"
            />
          ) : null}

          <button
            type="button"
            onClick={() =>
              select({ mailboxId: undefined, messageId: undefined })
            }
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-body-regular outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring ${
              !search.mailboxId
                ? 'bg-background-tertiary-default font-medium text-text-primary'
                : 'text-text-secondary hover:bg-background-secondary-hover'
            }`}
          >
            <RiMailLine className="size-4 shrink-0" aria-hidden />
            <span className="flex-1 truncate">全部邮箱</span>
          </button>

          {permanent.length > 0 ? (
            <p className="mt-3 px-1 text-caption-1-regular text-text-tertiary">
              长期邮箱
            </p>
          ) : null}
          {permanent.map((item) => (
            <MailboxRow
              key={item.id}
              item={item}
              active={search.mailboxId === item.id}
              onSelect={() =>
                select({ mailboxId: item.id, messageId: undefined })
              }
              onCopy={() => void copy(item.address)}
              onDelete={() => setDeleting(item)}
            />
          ))}

          {temp.length > 0 ? (
            <p className="mt-3 px-1 text-caption-1-regular text-text-tertiary">
              临时邮箱
            </p>
          ) : null}
          {temp.map((item) => (
            <MailboxRow
              key={item.id}
              item={item}
              active={search.mailboxId === item.id}
              onSelect={() =>
                select({ mailboxId: item.id, messageId: undefined })
              }
              onCopy={() => void copy(item.address)}
              onDelete={() => setDeleting(item)}
            />
          ))}

          {!loading && !error && mailboxes.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border-button-default p-4 text-center">
              <p className="text-caption-1-regular text-text-tertiary">
                还没有邮箱
              </p>
              <Button
                size="small"
                variant="secondary"
                className="mt-2"
                onClick={onCreate}
              >
                创建第一个邮箱
              </Button>
            </div>
          ) : null}

          {hasMore ? (
            <div className="mt-3 flex justify-center">
              <Button
                size="small"
                variant="secondary"
                onClick={onLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? '加载中...' : '加载更早的邮箱'}
              </Button>
            </div>
          ) : null}
        </div>
        <ScrollFade progress={fade.progress} />
      </div>

      <div className="rounded-xl border border-separator-border bg-background-primary-default p-3">
        <div className="flex items-center justify-between">
          <span className="text-caption-1-regular text-text-tertiary">
            今日发件
          </span>
          <span className="text-caption-1-semibold text-text-primary">
            {quota.data ? `${quota.data.sent}/${quota.data.limit}` : '—'}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background-tertiary-default">
          <div
            className="h-full rounded-full bg-accent-600 transition-[width]"
            style={{
              width: `${
                quota.data && quota.data.limit > 0
                  ? Math.min(100, (quota.data.sent / quota.data.limit) * 100)
                  : 0
              }%`,
            }}
          />
        </div>
        {/* The theme control is a fixed-width segmented switch, not the
            full-row "Dark mode" switch: paired with the remaining count in
            one row, the labelled switch squeezed the count onto two lines. */}
        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-separator-border pt-2.5">
          <span className="whitespace-nowrap text-caption-1-regular text-text-tertiary">
            {quota.data
              ? `剩余 ${quota.data.remaining} 封`
              : quota.isError
                ? '配额读取失败'
                : '配额加载中'}
          </span>
          <ThemeToggle appearance="segmented" size="small" />
        </div>
      </div>

      <AlertDialog
        isOpen={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="删除邮箱"
        description={
          deleting
            ? `确定删除「${deleting.address}」吗？地址会进入冷却期，期间无法被重新注册。`
            : ''
        }
        confirmLabel="删除"
        cancelLabel="取消"
        pendingLabel="删除中…"
        onConfirm={remove}
      />
    </div>
  )
}

function MailboxRow({
  item,
  active,
  onSelect,
  onCopy,
  onDelete,
}: {
  item: MailboxView
  active: boolean
  onSelect: () => void
  onCopy: () => void
  onDelete: () => void
}) {
  const expired = item.status === 'expired'
  return (
    <div
      className={`group flex items-center gap-1 rounded-lg pe-1 ${
        active ? 'bg-accent-50' : 'hover:bg-background-secondary-hover'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      >
        <span
          className={`size-1.5 shrink-0 rounded-full ${
            expired
              ? 'bg-text-tertiary'
              : item.kind === 'temp'
                ? 'bg-text-tertiary'
                : 'bg-accent-600'
          }`}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-body-regular ${
              expired
                ? 'text-text-tertiary line-through'
                : active
                  ? 'text-accent-700'
                  : 'text-text-primary'
            }`}
          >
            {item.address}
          </span>
          {item.kind === 'temp' ? (
            <span className="flex items-center gap-1 text-caption-1-regular text-text-tertiary">
              {item.retained ? (
                <>
                  <RiCheckLine className="size-3 text-accent-600" aria-hidden />
                  已永久保留
                </>
              ) : (
                <>
                  <RiTimeLine className="size-3" aria-hidden />
                  {expired ? '已失效' : remainingLabel(item.expiresAt)}
                </>
              )}
            </span>
          ) : null}
        </span>
        {item.unreadCount > 0 ? (
          <Counter color={active ? 'primary' : 'neutral'}>
            {item.unreadCount}
          </Counter>
        ) : null}
      </button>

      <Dropdown>
        <DropdownTrigger
          aria-label="邮箱操作"
          className="rounded-md p-1 text-foreground-icon-tertiary transition-opacity focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
        >
          <RiArrowDownSLine className="size-4" aria-hidden />
        </DropdownTrigger>
        <DropdownPopover aria-label="邮箱操作" placement="bottom end">
          <DropdownItem onSelect={onCopy}>
            <RiFileCopyLine className="size-4" aria-hidden /> 复制地址
          </DropdownItem>
          <DropdownDivider />
          <DropdownItem onSelect={onDelete}>
            <RiDeleteBinLine className="size-4" aria-hidden /> 删除邮箱
          </DropdownItem>
        </DropdownPopover>
      </Dropdown>
    </div>
  )
}

export function MailShell({ children }: { children: ReactNode }) {
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeOptions, setComposeOptions] = useState<ComposeOptions>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [q, setQ] = useState('')
  const search = mailRoute.useSearch()
  const navigate = useNavigate({ from: '/mail' })
  const queryClient = useQueryClient()
  const mailboxQuery = useInfiniteQuery(mailboxesInfiniteQuery())
  const mailboxes = useMemo(() => {
    const seen = new Set<string>()
    const result: MailboxView[] = []
    for (const page of mailboxQuery.data?.pages ?? []) {
      for (const item of page) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        result.push(item)
      }
    }
    return result
  }, [mailboxQuery.data])
  const { site } = rootApi.useLoaderData()
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setQ(search.q ?? '')
  }, [search.q])

  useEffect(() => {
    const timer = setTimeout(() => {
      if ((search.q ?? '') === q) return
      void navigate({
        search: (prev) => ({ ...prev, q: q || undefined }),
        replace: true,
      })
    }, 350)
    return () => clearTimeout(timer)
  }, [q, search.q, navigate])

  // 文档里承诺的快捷键：c 写信、/ 聚焦搜索
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        return
      }
      if (event.key === 'c') {
        event.preventDefault()
        setComposeOptions({})
        setComposeOpen(true)
        return
      }
      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // 未读数靠 60s 轮询更新，但轮询在隐藏标签页暂停、聚焦刷新又全局关闭，
  // 切回来必须主动补一次，否则要盯着旧徽标等半分钟。
  useEffect(() => {
    let last = 0
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - last < 5_000) return
      last = now
      void mailboxQuery.refetch()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [mailboxQuery.refetch])

  function refresh() {
    void mailboxQuery.refetch()
    void queryClient.invalidateQueries({ queryKey: queryKeys.quota })
    // 只刷新列表首页，不再走 navigate 触发全量 loader 重跑
    requestMailRefresh()
  }

  return (
    <>
      <AppShell
        fixed
        navLabel="导航"
        header={
          <>
            <div className="min-w-0 flex-1">
              <Input
                ref={searchRef}
                aria-label="搜索邮件"
                placeholder="搜索主题或发件人"
                leadingIcon={RiSearchLine}
                value={q}
                onChange={setQ}
                className="max-w-[520px]"
              />
            </div>
            <span className="hidden text-body-medium text-text-secondary md:block">
              {site.siteName}
            </span>
            <IconButton
              size="small"
              icon={RiRefreshLine}
              aria-label="刷新"
              onClick={refresh}
            />
          </>
        }
        sidebar={(closeNav) => (
          <RailContent
            mailboxes={mailboxes}
            loading={mailboxQuery.isLoading}
            error={mailboxQuery.isError ? mailboxQuery.error : null}
            onRetry={() => void mailboxQuery.refetch()}
            hasMore={Boolean(mailboxQuery.hasNextPage)}
            loadingMore={mailboxQuery.isFetchingNextPage}
            onLoadMore={() => void mailboxQuery.fetchNextPage()}
            onCompose={() => {
              setComposeOptions({})
              setComposeOpen(true)
              closeNav()
            }}
            onCreate={() => {
              setCreateOpen(true)
              closeNav()
            }}
            onNavigate={closeNav}
          />
        )}
      >
        <ComposeContext.Provider
          value={{
            openCompose: (options) => {
              setComposeOptions(options ?? {})
              setComposeOpen(true)
            },
          }}
        >
          {children}
        </ComposeContext.Provider>
      </AppShell>

      <ComposeModal
        isOpen={composeOpen}
        onOpenChange={setComposeOpen}
        mailboxes={mailboxes}
        allowTempSend={site.allowTempSend}
        defaultFromId={composeOptions.fromMailboxId}
        defaultTo={composeOptions.to}
        defaultSubject={composeOptions.subject}
      />
      <CreateMailboxModal isOpen={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
