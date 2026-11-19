import { useState } from 'react'
import type { ReactNode } from 'react'
import { RiMenuLine } from '@remixicon/react'

import { IconButton } from '@/components/base/buttons/icon-button'
import { Drawer, DrawerBody } from '@/components/base/drawer/drawer'
import { cx } from '@/utils/cx'

export function AppShell({
  navLabel,
  header,
  sidebar,
  children,
  fixed = false,
  contentClassName,
}: {
  navLabel: string
  header: ReactNode
  sidebar: (closeNav: () => void) => ReactNode
  children: ReactNode
  fixed?: boolean
  contentClassName?: string
}) {
  const [navOpen, setNavOpen] = useState(false)
  const closeNav = () => setNavOpen(false)

  return (
    <div
      className={cx(
        'flex bg-background-full',
        fixed ? 'h-dvh overflow-hidden' : 'min-h-dvh',
      )}
    >
      <aside className="hidden w-[272px] shrink-0 flex-col border-e border-separator-border bg-background-secondary-default p-3 lg:flex">
        {sidebar(closeNav)}
      </aside>

      <Drawer
        placement="start"
        size="sm"
        isOpen={navOpen}
        onOpenChange={setNavOpen}
        aria-label={navLabel}
        // Drop Modal's 24px vertical padding so the rail fills the panel.
        className="py-0"
      >
        <DrawerBody className="w-full p-3">{sidebar(closeNav)}</DrawerBody>
      </Drawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-separator-border px-3 lg:px-5">
          <IconButton
            className="lg:hidden"
            size="small"
            icon={RiMenuLine}
            aria-label={`打开${navLabel}`}
            onClick={() => setNavOpen(true)}
          />
          {header}
        </header>
        {fixed ? (
          <main className="flex min-h-0 flex-1">{children}</main>
        ) : (
          <div className={cx('p-4 md:p-6', contentClassName)}>{children}</div>
        )}
      </div>
    </div>
  )
}
