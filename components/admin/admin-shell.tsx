import { useState, type ReactNode } from 'react'
import {
  Link,
  getRouteApi,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import {
  RiArrowLeftLine,
  RiGlobalLine,
  RiKey2Line,
  RiLockPasswordLine,
  RiMailLine,
  RiMenuLine,
  RiSettings4Line,
  RiShieldKeyholeLine,
  RiTeamLine,
  RiTelegram2Line,
  RiTerminalBoxLine,
} from '@remixicon/react'

import { Avatar } from '@/components/base/avatar/avatar'
import { Button } from '@/components/base/buttons/button'
import { IconButton } from '@/components/base/buttons/icon-button'
import { Drawer, DrawerBody } from '@/components/base/drawer/drawer'
import { cx } from '@/utils/cx'
import { authClient } from '#/lib/auth-client'

const rootApi = getRouteApi('__root__')

const NAV = [
  { to: '/admin', label: '概览', icon: RiShieldKeyholeLine, exact: true },
  { to: '/admin/site', label: '站点信息', icon: RiSettings4Line, exact: false },
  { to: '/admin/domains', label: '域名', icon: RiGlobalLine, exact: false },
  { to: '/admin/providers', label: '服务商', icon: RiKey2Line, exact: false },
  {
    to: '/admin/auth',
    label: '登录',
    icon: RiLockPasswordLine,
    exact: false,
  },
  {
    to: '/admin/telegram',
    label: 'Telegram',
    icon: RiTelegram2Line,
    exact: false,
  },
  { to: '/admin/users', label: '用户', icon: RiTeamLine, exact: false },
  { to: '/admin/logs', label: '日志', icon: RiTerminalBoxLine, exact: false },
] as const

function Brand() {
  return (
    <div className="flex items-center gap-2 px-2 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-600 text-body-medium text-white">
        <RiMailLine className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-body-medium text-text-primary">asms2</p>
        <p className="truncate text-caption-1-regular text-text-tertiary">
          管理后台
        </p>
      </div>
    </div>
  )
}

function AdminNav({
  pathname,
  onNavigate,
}: {
  pathname: string
  onNavigate?: () => void
}) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = item.exact
          ? pathname === item.to
          : pathname.startsWith(item.to)
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'flex items-center gap-2 rounded-lg px-2.5 py-2 text-body-medium transition-colors',
              active
                ? 'bg-accent-50 text-accent-700'
                : 'text-text-secondary hover:bg-background-secondary-hover',
            )}
          >
            <item.icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

function AccountPanel({
  name,
  email,
  onNavigate,
}: {
  name?: string
  email?: string
  onNavigate?: () => void
}) {
  const navigate = useNavigate()

  return (
    <div className="mt-auto flex flex-col gap-2 border-t border-separator-border pt-3">
      <div className="flex items-center gap-2 px-1">
        <Avatar size="sm" initials={(name ?? 'A').slice(0, 1)} />
        <div className="min-w-0">
          <p className="truncate text-caption-1-semibold text-text-primary">
            {name}
          </p>
          <p className="truncate text-caption-1-regular text-text-tertiary">
            {email}
          </p>
        </div>
      </div>
      <Button
        variant="secondary"
        size="small"
        leadingIcon={RiArrowLeftLine}
        onClick={() => {
          onNavigate?.()
          void navigate({ to: '/mail', search: { folder: 'inbox' } })
        }}
      >
        返回邮箱
      </Button>
      <Button
        variant="ghost"
        size="small"
        onClick={async () => {
          onNavigate?.()
          await authClient.signOut()
          await navigate({ to: '/login' })
        }}
      >
        退出登录
      </Button>
    </div>
  )
}

export function AdminShell({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false)
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const navigate = useNavigate()
  const { session } = rootApi.useRouteContext()

  return (
    <div className="flex min-h-dvh bg-background-full">
      <aside className="hidden w-[248px] shrink-0 flex-col border-e border-separator-border bg-background-secondary-default p-3 md:flex">
        <Brand />
        <div className="mt-4">
          <AdminNav pathname={pathname} />
        </div>
        <AccountPanel name={session?.name} email={session?.email} />
      </aside>

      {/* Below md the rail becomes a drawer: eight nav sections do not fit in
          the header, where they used to squeeze the page title and scroll
          items out of view. */}
      <Drawer
        placement="start"
        size="sm"
        isOpen={navOpen}
        onOpenChange={setNavOpen}
        aria-label="管理导航"
        className="py-0"
      >
        <DrawerBody className="w-full p-3">
          <div className="flex h-full min-h-0 flex-col gap-4">
            <Brand />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AdminNav
                pathname={pathname}
                onNavigate={() => setNavOpen(false)}
              />
            </div>
            <AccountPanel
              name={session?.name}
              email={session?.email}
              onNavigate={() => setNavOpen(false)}
            />
          </div>
        </DrawerBody>
      </Drawer>

      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center gap-2 border-b border-separator-border px-3 md:px-6">
          <IconButton
            className="md:hidden"
            size="small"
            icon={RiMenuLine}
            aria-label="打开管理导航"
            onClick={() => setNavOpen(true)}
          />
          <h1 className="min-w-0 flex-1 truncate text-title-3-semibold text-text-primary">
            管理后台
          </h1>
          <IconButton
            className="md:hidden"
            size="small"
            icon={RiMailLine}
            aria-label="返回邮箱"
            onClick={() =>
              void navigate({ to: '/mail', search: { folder: 'inbox' } })
            }
          />
        </header>
        <div className="p-4 md:p-6">{children}</div>
      </div>
    </div>
  )
}
