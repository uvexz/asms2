import {
  Outlet,
  createFileRoute,
  notFound,
  redirect,
} from '@tanstack/react-router'

import { AdminShell } from '@/components/admin/admin-shell'

export const Route = createFileRoute('/admin')({
  head: () => ({ meta: [{ title: '管理后台' }] }),
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: '/login' })
    if (context.session.role !== 'admin') throw notFound()
    if (
      context.session.emailVerificationRequired &&
      !context.session.emailVerified
    ) {
      throw redirect({ to: '/verify-email' })
    }
  },
  component: AdminLayout,
})

function AdminLayout() {
  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  )
}
