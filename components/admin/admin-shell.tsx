import type { ReactNode } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  RiArrowLeftLine,
  RiGlobalLine,
  RiKey2Line,
  RiMailLine,
  RiSettings4Line,
  RiShieldKeyholeLine,
  RiTeamLine,
  RiTelegram2Line,
  RiTerminalBoxLine,
} from '@remixicon/react'

import { Avatar } from '@/components/base/avatar/avatar'
import { Button } from '@/components/base/buttons/button'
import { cx } from '@/utils/cx'
import { authClient } from '#/lib/auth-client'
import { getRouteApi } from '@tanstack/react-router'

const rootApi = getRouteApi('__root__')

const NAV = [
  { to: '/admin', label: '概览', icon: RiShieldKeyholeLine, exact: true },
  { to: '/admin/site', label: '站点信息', icon: RiSettings4Line },
  { to: '/admin/domains', label: '域名', icon: RiGlobalLine },
  { to: '/admin/providers', label: '服务商', icon: RiKey2Line },
  { to: '/admin/auth', label: '第三方登录', icon: RiShieldKeyholeLine },
  { to: '/admin/telegram', label: 'Telegram', icon: RiTelegram2Line },
  { to: '/admin/users', label: '用户', icon: RiTeamLine },
  { to: '/admin/logs', label: '日志', icon: RiTerminalBoxLine },
]

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const navigate = useNavigate()
  const { session } = rootApi.useRouteContext()

  return (
    <div className="flex min-h-dvh bg-background-full">
      <aside className="hidden w-[248px] shrink-0 flex-col border-e border-separator-border bg-background-secondary-default p-3 md:flex">
        <div className="flex items-center gap-2 px-2 py-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent-600 text-body-medium text-white">
            <RiMailLine className="size-4" aria-hidden />
          </span>
          <div>
            <p className="text-body-medium text-text-primary">asms2</p>
            <p className="text-caption-1-regular text-text-tertiary">
              管理后台
            </p>
          </div>
        </div>

        <nav className="mt-4 flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.to
              : pathname.startsWith(item.to)
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cx(
                  'flex items-center gap-2 rounded-lg px-2.5 py-2 text-body-medium transition-colors',
                  active
                    ? 'bg-accent-50 text-accent-700'
                    : 'text-text-secondary hover:bg-background-secondary-hover',
                )}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2 border-t border-separator-border pt-3">
          <div className="flex items-center gap-2 px-1">
            <Avatar size="sm" initials={(session?.name ?? 'A').slice(0, 1)} />
            <div className="min-w-0">
              <p className="truncate text-caption-1-semibold text-text-primary">
                {session?.name}
              </p>
              <p className="truncate text-caption-1-regular text-text-tertiary">
                {session?.email}
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="small"
            leadingIcon={RiArrowLeftLine}
            onClick={() =>
              void navigate({ to: '/mail', search: { folder: 'inbox' } })
            }
          >
            返回邮箱
          </Button>
          <Button
            variant="ghost"
            size="small"
            onClick={async () => {
              await authClient.signOut()
              await navigate({ to: '/login' })
            }}
          >
            退出登录
          </Button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center justify-between border-b border-separator-border px-4 md:px-6">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="small"
              leadingIcon={RiArrowLeftLine}
              className="md:hidden"
              onClick={() =>
                void navigate({ to: '/mail', search: { folder: 'inbox' } })
              }
            >
              邮箱
            </Button>
            <h1 className="text-title-3-semibold text-text-primary">
              管理后台
            </h1>
          </div>
          <nav className="flex gap-1 overflow-x-auto md:hidden">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="whitespace-nowrap rounded-md px-2 py-1 text-caption-1-medium text-text-secondary"
                activeProps={{ className: 'bg-accent-50 text-accent-700' }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <div className="p-4 md:p-6">{children}</div>
      </div>
    </div>
  )
}
