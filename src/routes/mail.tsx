import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { MailShell } from '#/components/mail/mail-shell'
import { RouteErrorState } from '#/components/application/errors/error-state'
import { mailboxesQuery, messagesInfiniteQuery, quotaQuery } from '#/lib/api'
import type { MailFolder } from '#/lib/query-keys'

const FOLDERS = ['inbox', 'sent', 'spam', 'trash', 'archive'] as const

export interface MailSearch {
  folder: MailFolder
  mailboxId?: string
  q?: string
}

export const Route = createFileRoute('/mail')({
  validateSearch: (search: Record<string, unknown>): MailSearch => {
    const folder = FOLDERS.includes(search.folder as MailFolder)
      ? (search.folder as MailFolder)
      : 'inbox'
    return {
      folder,
      mailboxId:
        typeof search.mailboxId === 'string' ? search.mailboxId : undefined,
      q: typeof search.q === 'string' ? search.q : undefined,
    }
  },
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: '/login' })
    if (
      context.session.emailVerificationRequired &&
      !context.session.emailVerified
    ) {
      throw redirect({ to: '/verify-email' })
    }
  },
  // 首屏数据在 loader 里预取：SSR 直接带出邮箱、配额与第一页邮件
  loaderDeps: ({ search }) => ({
    folder: search.folder,
    mailboxId: search.mailboxId,
    q: search.q,
  }),
  loader: async ({ context, deps }) => {
    const messages = messagesInfiniteQuery({
      folder: deps.folder,
      mailboxId: deps.mailboxId,
      q: deps.q,
    })

    await Promise.all([
      context.queryClient.query(mailboxesQuery),
      context.queryClient.query(quotaQuery),
      // 无限查询的 refetch 会把已加载的每一页串行重取一遍，放在导航关键路径上
      // 就是"再次进入看过的文件夹 = N 次 RPC + 白屏"。有缓存就先渲染，
      // 新鲜度交给列表的 20s 轮询。
      context.queryClient.getQueryData(messages.queryKey)
        ? Promise.resolve()
        : context.queryClient.infiniteQuery(messages),
    ])
  },
  head: () => ({ meta: [{ title: '邮箱' }] }),
  errorComponent: RouteErrorState,
  component: MailLayout,
})

function MailLayout() {
  return (
    <MailShell>
      <Outlet />
    </MailShell>
  )
}
