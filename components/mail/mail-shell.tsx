import { useEffect, useState, type ReactNode } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiInboxLine,
  RiLogoutBoxRLine,
  RiMailLine,
  RiMailSendLine,
  RiMenuLine,
  RiRefreshLine,
  RiSearchLine,
  RiSettings4Line,
  RiShieldKeyholeLine,
  RiSpam2Line,
  RiTimeLine,
} from '@remixicon/react'

import { Avatar } from '@/components/base/avatar/avatar'
import { Counter } from '@/components/base/badges/counter'
import { Button } from '@/components/base/buttons/button'
import { IconButton } from '@/components/base/buttons/icon-button'
import {
  Dropdown,
  DropdownDivider,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from '@/components/base/dropdown/dropdown'
import { Drawer, DrawerBody } from '@/components/base/drawer/drawer'
import { Input } from '@/components/base/input/input'
import { Spinner } from '@/components/base/spinner/spinner'
import { ThemeToggle } from '@/components/application/theme/theme-toggle'
import { toast } from '@/components/base/toast/toast'
import { authClient } from '#/lib/auth-client'
import { mailboxesQuery, quotaQuery, remainingLabel } from '#/lib/api'
import type { MailboxView } from '#/server/mail/mailbox'
import { removeMailboxFn } from '#/server/fns/mail'

import { ComposeModal } from './compose-modal'
import { ComposeContext, type ComposeOptions } from './compose-context'
import { CreateMailboxModal } from './create-mailbox-modal'

const mailRoute = getRouteApi('/mail')
const rootApi = getRouteApi('__root__')

const FOLDERS = [
  { key: 'inbox', label: '收件箱', icon: RiInboxLine },
  { key: 'sent', label: '已发送', icon: RiMailSendLine },
  { key: 'spam', label: '垃圾邮件', icon: RiSpam2Line },
  { key: 'trash', label: '回收站', icon: RiDeleteBinLine },
] as const

function RailContent({
  mailboxes,
  loading,
  onCompose,
  onCreate,
  onNavigate,
}: {
  mailboxes: MailboxView[]
  loading: boolean
  onCompose: () => void
  onCreate: () => void
  onNavigate?: () => void
}) {
  const search = mailRoute.useSearch()
  const navigate = useNavigate({ from: '/mail' })
  const { session } = rootApi.useRouteContext()
  const queryClient = useQueryClient()
  const quota = useQuery(quotaQuery)

  const permanent = mailboxes.filter((item) => item.kind === 'permanent')
  const temp = mailboxes.filter((item) => item.kind === 'temp')
  const totalUnread = mailboxes.reduce((sum, item) => sum + item.unreadCount, 0)

  function select(patch: Record<string, unknown>) {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
    onNavigate?.()
  }

  async function copy(address: string) {
    await navigator.clipboard.writeText(address)
    toast.success('地址已复制')
  }

  async function remove(id: string) {
    const result = await removeMailboxFn({ data: { id } })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('邮箱已删除')
    if (search.mailboxId === id) {
      select({ mailboxId: undefined, messageId: undefined })
    }
    await queryClient.invalidateQueries({ queryKey: ['mailboxes'] })
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar
            size="sm"
            initials={(session?.name ?? session?.email ?? 'U')
              .slice(0, 1)
              .toUpperCase()}
          />
          <div className="min-w-0">
            <p className="truncate text-body-medium text-text-primary">
              {session?.name ?? '未登录'}
            </p>
            <p className="truncate text-caption-1-regular text-text-tertiary">
              {session?.email}
            </p>
          </div>
        </div>
        <Dropdown>
          <DropdownTrigger
            aria-label="账户菜单"
            className="rounded-lg p-1.5 text-foreground-icon-secondary hover:bg-background-secondary-hover"
          >
            <RiArrowDownSLine className="size-4" aria-hidden />
          </DropdownTrigger>
          <DropdownPopover aria-label="账户菜单" placement="bottom end">
            <DropdownItem
              onSelect={() => {
                void navigate({ to: '/settings' })
              }}
            >
              <RiSettings4Line className="size-4" aria-hidden /> 个人设置
            </DropdownItem>
            {session?.role === 'admin' ? (
              <DropdownItem
                onSelect={() => {
                  void navigate({ to: '/admin' })
                }}
              >
                <RiShieldKeyholeLine className="size-4" aria-hidden /> 管理后台
              </DropdownItem>
            ) : null}
            <DropdownDivider />
            <DropdownItem
              onSelect={async () => {
                await authClient.signOut()
                await navigate({ to: '/login' })
              }}
            >
              <RiLogoutBoxRLine className="size-4" aria-hidden /> 退出登录
            </DropdownItem>
          </DropdownPopover>
        </Dropdown>
      </div>

      <Button className="w-full" leadingIcon={RiAddLine} onClick={onCompose}>
        写信
      </Button>

      <nav className="flex flex-col gap-0.5">
        {FOLDERS.map((folder) => {
          const active = search.folder === folder.key
          return (
            <button
              key={folder.key}
              type="button"
              onClick={() =>
                select({ folder: folder.key, messageId: undefined })
              }
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-body-medium transition-colors ${
                active
                  ? 'bg-accent-50 text-accent-700'
                  : 'text-text-secondary hover:bg-background-secondary-hover'
              }`}
            >
              <folder.icon className="size-4 shrink-0" aria-hidden />
              <span className="flex-1 truncate">{folder.label}</span>
              {folder.key === 'inbox' && totalUnread > 0 ? (
                <Counter color="primary">{totalUnread}</Counter>
              ) : null}
            </button>
          )
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
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

        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-5" />
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => select({ mailboxId: undefined, messageId: undefined })}
          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-body-regular ${
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
            onDelete={() => void remove(item.id)}
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
            onDelete={() => void remove(item.id)}
          />
        ))}

        {!loading && mailboxes.length === 0 ? (
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
            {quota.data ? `剩余 ${quota.data.remaining} 封` : '配额加载中'}
          </span>
          <ThemeToggle appearance="segmented" size="small" />
        </div>
      </div>
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
        className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-start"
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
  const [mobileOpen, setMobileOpen] = useState(false)
  const [q, setQ] = useState('')
  const search = mailRoute.useSearch()
  const navigate = useNavigate({ from: '/mail' })
  const queryClient = useQueryClient()
  const mailboxes = useQuery(mailboxesQuery)
  const { site } = rootApi.useLoaderData()

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

  const rail = (
    <RailContent
      mailboxes={mailboxes.data ?? []}
      loading={mailboxes.isLoading}
      onCompose={() => {
        setComposeOptions({})
        setComposeOpen(true)
        setMobileOpen(false)
      }}
      onCreate={() => {
        setCreateOpen(true)
        setMobileOpen(false)
      }}
      onNavigate={() => setMobileOpen(false)}
    />
  )

  return (
    <div className="flex h-dvh overflow-hidden bg-background-full">
      <aside className="hidden w-[272px] shrink-0 flex-col border-e border-separator-border bg-background-secondary-default p-3 lg:flex">
        {rail}
      </aside>

      <Drawer
        placement="start"
        size="sm"
        isOpen={mobileOpen}
        onOpenChange={setMobileOpen}
        aria-label="导航"
        // Drop Modal's 24px vertical padding so the rail fills the panel.
        className="py-0"
      >
        <DrawerBody className="w-full p-3">{rail}</DrawerBody>
      </Drawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-separator-border px-3 lg:px-5">
          <IconButton
            className="lg:hidden"
            size="small"
            icon={RiMenuLine}
            aria-label="打开导航"
            onClick={() => setMobileOpen(true)}
          />
          <div className="min-w-0 flex-1">
            <Input
              aria-label="搜索邮件"
              placeholder="搜索主题或发件人"
              leadingIcon={RiSearchLine}
              value={q}
              onChange={setQ}
              className="max-w-[520px]"
            />
          </div>
          <span className="hidden text-body-medium text-text-secondary md:block">
            {site?.siteName ?? 'asms2'}
          </span>
          <IconButton
            size="small"
            icon={RiRefreshLine}
            aria-label="刷新"
            onClick={() => {
              void mailboxes.refetch()
              void queryClient.invalidateQueries({ queryKey: ['messages'] })
              void queryClient.invalidateQueries({
                queryKey: ['messages-latest'],
              })
              void navigate({ search: (prev) => ({ ...prev }), replace: true })
            }}
          />
        </header>

        <main className="flex min-h-0 flex-1">
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
        </main>
      </div>

      <ComposeModal
        isOpen={composeOpen}
        onOpenChange={setComposeOpen}
        mailboxes={mailboxes.data ?? []}
        defaultFromId={composeOptions.fromMailboxId}
        defaultTo={composeOptions.to}
        defaultSubject={composeOptions.subject}
      />
      <CreateMailboxModal isOpen={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
