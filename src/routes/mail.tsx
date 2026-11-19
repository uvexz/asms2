import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { MailShell } from '#/components/mail/mail-shell'
import { RouteErrorState } from '#/components/application/errors/error-state'
import { mailboxesQuery, messagesInfiniteQuery, quotaQuery } from '#/lib/api'

const FOLDERS = ['inbox', 'sent', 'spam', 'trash', 'archive'] as const
export type MailFolder = (typeof FOLDERS)[number]

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
    await Promise.all([
      context.queryClient.ensureQueryData(mailboxesQuery),
      context.queryClient.ensureQueryData(quotaQuery),
      context.queryClient.ensureInfiniteQueryData(
        messagesInfiniteQuery({
          folder: deps.folder,
          mailboxId: deps.mailboxId,
          q: deps.q,
        }),
      ),
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
