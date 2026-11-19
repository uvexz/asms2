import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { MailShell } from '@/components/mail/mail-shell'

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
  component: MailLayout,
})

function MailLayout() {
  return (
    <MailShell>
      <Outlet />
    </MailShell>
  )
}
