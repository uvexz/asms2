import { Outlet, createFileRoute, notFound, redirect } from '@tanstack/react-router'

import { AdminShell } from '@/components/admin/admin-shell'

export const Route = createFileRoute('/admin')({
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: '/login' })
    if (context.session.role !== 'admin') throw notFound()
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
