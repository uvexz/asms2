import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RiSaveLine, RiSearchLine } from '@remixicon/react'

import { Button } from '@/components/base/buttons/button'
import { Chip } from '@/components/base/badges/chip'
import { Input } from '@/components/base/input/input'
import { Select, SelectItem } from '@/components/base/select/select'
import { Switch } from '@/components/base/switch/switch'
import { Spinner } from '@/components/base/spinner/spinner'
import { toast } from '@/components/base/toast/toast'
import { PageSection } from '@/components/admin/ui'
import { adminListUsersFn, adminUpdateUserFn } from '#/server/fns/admin'
import { unwrap } from '#/lib/api'

export const Route = createFileRoute('/admin/users')({
  component: AdminUsers,
})

interface UserRow {
  id: string
  name: string
  email: string
  role: string | null
  banned: boolean | null
  mailboxLimit: number | null
  sendLimit: number | null
  createdAt: number
  mailboxCount: number
}

function AdminUsers() {
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')

  const query = useQuery({
    queryKey: ['admin', 'users', search],
    queryFn: async () =>
      unwrap(await adminListUsersFn({ data: { q: search || undefined } })),
  })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
  }

  return (
    <div className="flex flex-col gap-5">
      <PageSection
        title="用户"
        description="配额留空表示跟随站点默认值"
        actions={
          <div className="flex items-end gap-2">
            <Input
              aria-label="搜索用户"
              placeholder="按邮箱搜索"
              leadingIcon={RiSearchLine}
              value={q}
              onChange={setQ}
            />
            <Button
              variant="secondary"
              size="small"
              onClick={() => setSearch(q)}
            >
              搜索
            </Button>
          </div>
        }
      >
        {query.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner className="size-5" />
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          {(query.data ?? []).map((row: UserRow) => (
            <UserCard key={row.id} row={row} onSaved={() => void refresh()} />
          ))}
        </div>
      </PageSection>
    </div>
  )
}

function UserCard({ row, onSaved }: { row: UserRow; onSaved: () => void }) {
  const [role, setRole] = useState(row.role === 'admin' ? 'admin' : 'user')
  const [banned, setBanned] = useState(Boolean(row.banned))
  const [mailboxLimit, setMailboxLimit] = useState(
    row.mailboxLimit === null ? '' : String(row.mailboxLimit),
  )
  const [sendLimit, setSendLimit] = useState(
    row.sendLimit === null ? '' : String(row.sendLimit),
  )
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const result = await adminUpdateUserFn({
      data: {
        id: row.id,
        role: role as 'user' | 'admin',
        banned,
        mailboxLimit: mailboxLimit === '' ? null : Number(mailboxLimit),
        sendLimit: sendLimit === '' ? null : Number(sendLimit),
      },
    })
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('用户已更新')
    onSaved()
  }

  return (
    <div className="rounded-2xl border border-border-button-default p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-body-medium text-text-primary">
              {row.name}
            </p>
            {role === 'admin' ? <Chip color="blue">管理员</Chip> : null}
            {banned ? <Chip color="rose">已封禁</Chip> : null}
            <Chip color="gray">{row.mailboxCount} 个邮箱</Chip>
          </div>
          <p className="truncate text-caption-1-regular text-text-tertiary">
            {row.email}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-caption-1-regular text-text-secondary">
            封禁
            <Switch isSelected={banned} onChange={setBanned} />
          </label>
          <Button
            size="small"
            variant="secondary"
            leadingIcon={RiSaveLine}
            onClick={save}
            disabled={saving}
          >
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Select
          label="角色"
          selectedKey={role}
          onSelectionChange={(key) => setRole(String(key))}
        >
          <SelectItem id="user">普通用户</SelectItem>
          <SelectItem id="admin">管理员</SelectItem>
        </Select>
        <Input
          label="长期邮箱上限"
          type="number"
          placeholder="跟随站点"
          value={mailboxLimit}
          onChange={setMailboxLimit}
        />
        <Input
          label="每日发件上限"
          type="number"
          placeholder="跟随站点"
          value={sendLimit}
          onChange={setSendLimit}
        />
      </div>
    </div>
  )
}
