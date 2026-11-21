import type { ComponentType, ReactNode } from 'react'
import {
  Link,
  getRouteApi,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  RiArrowDownSLine,
  RiFileTextLine,
  RiLogoutBoxRLine,
  RiMailLine,
  RiSettings4Line,
  RiShieldCheckLine,
  RiShieldKeyholeLine,
} from '@remixicon/react'

import { UserAvatar } from '#/components/shell/user-avatar'
import { clearUserCaches } from '#/lib/api'
import {
  Dropdown,
  DropdownDivider,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from '#/components/base/dropdown/dropdown'
import { cx } from '#/utils/cx'
import { authClient } from '#/lib/auth-client'
import type { FileRoutesByTo } from '#/routeTree.gen'

const rootApi = getRouteApi('__root__')

type IconComponent = ComponentType<{
  className?: string
  'aria-hidden'?: boolean | 'true' | 'false'
}>

export function SidebarNav({ children }: { children: ReactNode }) {
  return <nav className="flex flex-col gap-0.5">{children}</nav>
}

function itemClass(active: boolean) {
  return cx(
    'flex items-center gap-2 rounded-lg px-2.5 py-2 text-body-medium transition-colors outline-none',
    'focus-visible:ring-2 focus-visible:ring-border-focus-ring',
    active
      ? 'bg-accent-50 text-accent-700'
      : 'text-text-secondary hover:bg-background-secondary-hover',
  )
}

interface SidebarNavItemProps {
  icon: IconComponent
  label: string
  active: boolean
  trailing?: ReactNode
}

export function SidebarNavButton({
  icon: Icon,
  label,
  active,
  trailing,
  onClick,
}: SidebarNavItemProps & { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx('w-full text-start', itemClass(active))}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </button>
  )
}

export function SidebarNavLink({
  to,
  icon: Icon,
  label,
  active,
  trailing,
  onClick,
}: SidebarNavItemProps & { to: keyof FileRoutesByTo; onClick?: () => void }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={itemClass(active)}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </Link>
  )
}

export function SidebarAccount() {
  const { session } = rootApi.useRouteContext()
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const inAdmin = pathname.startsWith('/admin')

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <UserAvatar
          name={session?.name}
          email={session?.email}
          image={session?.image}
          size="sm"
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
            inAdmin ? (
              <DropdownItem
                onSelect={() => {
                  void navigate({ to: '/mail', search: { folder: 'inbox' } })
                }}
              >
                <RiMailLine className="size-4" aria-hidden /> 返回邮箱
              </DropdownItem>
            ) : (
              <DropdownItem
                onSelect={() => {
                  void navigate({ to: '/admin' })
                }}
              >
                <RiShieldKeyholeLine className="size-4" aria-hidden /> 管理后台
              </DropdownItem>
            )
          ) : null}
          <DropdownDivider />
          <DropdownItem
            onSelect={() => {
              void navigate({ to: '/terms' })
            }}
          >
            <RiFileTextLine className="size-4" aria-hidden /> 服务条款
          </DropdownItem>
          <DropdownItem
            onSelect={() => {
              void navigate({ to: '/privacy' })
            }}
          >
            <RiShieldCheckLine className="size-4" aria-hidden /> 隐私政策
          </DropdownItem>
          <DropdownDivider />
          <DropdownItem
            onSelect={async () => {
              await authClient.signOut()
              // Passkey 等客户端登录不会重建 QueryClient，必须显式清缓存，
              // 否则换号后首屏会读到上一个账号的邮件/邮箱数据
              clearUserCaches(queryClient)
              // 当前路由的守卫会重定向到登录页，invalidate 期间的跳转不算错误
              await router.invalidate().catch(() => undefined)
              await navigate({ to: '/login' })
            }}
          >
            <RiLogoutBoxRLine className="size-4" aria-hidden /> 退出登录
          </DropdownItem>
        </DropdownPopover>
      </Dropdown>
    </div>
  )
}
