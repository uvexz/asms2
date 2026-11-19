import type { ReactNode } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import {
  RiGlobalLine,
  RiKey2Line,
  RiLockPasswordLine,
  RiMailLine,
  RiSettings4Line,
  RiShieldKeyholeLine,
  RiTeamLine,
  RiTelegram2Line,
  RiTerminalBoxLine,
} from '@remixicon/react'

import { IconButton } from '#/components/base/buttons/icon-button'
import { ThemeToggle } from '#/components/application/theme/theme-toggle'
import { AppShell } from '#/components/shell/app-shell'
import {
  SidebarAccount,
  SidebarNav,
  SidebarNavLink,
} from '#/components/shell/sidebar'

const NAV = [
  { to: '/admin', label: '管理概览', icon: RiShieldKeyholeLine, exact: true },
  { to: '/admin/site', label: '站点信息', icon: RiSettings4Line, exact: false },
  {
    to: '/admin/domains',
    label: '域名管理',
    icon: RiGlobalLine,
    exact: false,
  },
  {
    to: '/admin/providers',
    label: '发信服务',
    icon: RiKey2Line,
    exact: false,
  },
  {
    to: '/admin/auth',
    label: '登录设置',
    icon: RiLockPasswordLine,
    exact: false,
  },
  {
    to: '/admin/telegram',
    label: 'Telegram',
    icon: RiTelegram2Line,
    exact: false,
  },
  { to: '/admin/users', label: '用户管理', icon: RiTeamLine, exact: false },
  {
    to: '/admin/logs',
    label: '系统日志',
    icon: RiTerminalBoxLine,
    exact: false,
  },
] as const

function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <SidebarNav>
      {NAV.map((item) => (
        <SidebarNavLink
          key={item.to}
          to={item.to}
          icon={item.icon}
          label={item.label}
          active={
            item.exact ? pathname === item.to : pathname.startsWith(item.to)
          }
          onClick={onNavigate}
        />
      ))}
    </SidebarNav>
  )
}

export function AdminShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate()

  return (
    <AppShell
      navLabel="管理导航"
      header={
        <>
          <h1 className="min-w-0 flex-1 truncate text-title-3-semibold text-text-primary">
            管理后台
          </h1>
          <IconButton
            className="lg:hidden"
            size="small"
            icon={RiMailLine}
            aria-label="返回邮箱"
            onClick={() =>
              void navigate({ to: '/mail', search: { folder: 'inbox' } })
            }
          />
        </>
      }
      sidebar={(closeNav) => (
        <div className="flex h-full min-h-0 flex-col gap-4">
          <SidebarAccount />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AdminNav onNavigate={closeNav} />
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-separator-border pt-3">
            <span className="text-caption-1-regular text-text-tertiary">
              主题
            </span>
            <ThemeToggle appearance="segmented" size="small" />
          </div>
        </div>
      )}
    >
      {children}
    </AppShell>
  )
}
