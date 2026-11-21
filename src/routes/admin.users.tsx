import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RiSaveLine, RiSearchLine } from '@remixicon/react'

import { Button } from '#/components/base/buttons/button'
import { Chip } from '#/components/base/badges/chip'
import type { ChipColor } from '#/components/base/badges/chip'
import { Input } from '#/components/base/input/input'
import { Select, SelectItem } from '#/components/base/select/select'
import { Switch } from '#/components/base/switch/switch'
import { Spinner } from '#/components/base/spinner/spinner'
import { toast } from '#/components/base/toast/toast'
import { ErrorState } from '#/components/application/errors/error-state'
import { PageSection } from '#/components/admin/ui'
import { adminListUsersFn, adminUpdateUserFn } from '#/server/fns/admin'
import { unwrap } from '#/lib/api'
import { queryKeys } from '#/lib/query-keys'

export const Route = createFileRoute('/admin/users')({
  head: () => ({ meta: [{ title: '用户 · 管理后台' }] }),
  component: AdminUsers,
})

const PAGE_SIZE = 50

type LoginMethodKind = 'email' | 'google' | 'github' | 'oidc'

interface LoginMethod {
  providerId: string
  label: string
  kind: LoginMethodKind
}

/** 登录来源一眼可辨：本站密码用中性色，OAuth 品牌蓝色，通用 OIDC 紫色 */
const METHOD_CHIP_COLOR: Record<LoginMethodKind, ChipColor> = {
  email: 'neutral',
  google: 'blue',
  github: 'blue',
  oidc: 'purple',
}

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
  passkeyCount: number
  loginMethods: LoginMethod[]
}

function AdminUsers() {
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)

  const query = useQuery({
    queryKey: queryKeys.admin.users.list(search, offset),
    queryFn: async () =>
      unwrap(
        await adminListUsersFn({
          data: { q: search || undefined, limit: PAGE_SIZE, offset },
        }),
      ),
  })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all })
  }

  function submitSearch() {
    setOffset(0)
    setSearch(q)
  }

  const rows = query.data?.rows ?? []

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
            <Button variant="secondary" size="small" onClick={submitSearch}>
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

        {query.isError ? (
          <ErrorState
            error={query.error}
            title="用户列表加载失败"
            onRetry={() => void query.refetch()}
          />
        ) : null}

        {!query.isLoading && !query.isError && rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-button-default p-4 text-center text-caption-1-regular text-text-tertiary">
            {search ? '没有匹配的用户' : '还没有用户'}
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          {rows.map((row: UserRow) => (
            <UserCard key={row.id} row={row} onSaved={() => void refresh()} />
          ))}
        </div>

        {rows.length > 0 ? (
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-caption-1-regular text-text-tertiary">
              第 {offset + 1}–{offset + rows.length} 位
            </span>
            <div className="flex gap-2">
              <Button
                size="small"
                variant="secondary"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                上一页
              </Button>
              <Button
                size="small"
                variant="secondary"
                disabled={!query.data?.hasMore}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                下一页
              </Button>
            </div>
          </div>
        ) : null}
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

  // 查询刷新后表单要跟着同步，否则会一直显示挂载时的旧值
  useEffect(() => {
    setRole(row.role === 'admin' ? 'admin' : 'user')
    setBanned(Boolean(row.banned))
    setMailboxLimit(row.mailboxLimit === null ? '' : String(row.mailboxLimit))
    setSendLimit(row.sendLimit === null ? '' : String(row.sendLimit))
  }, [row.id, row.role, row.banned, row.mailboxLimit, row.sendLimit])

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
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-caption-1-regular text-text-tertiary">
              登录来源
            </span>
            {row.loginMethods.length === 0 ? (
              <span className="text-caption-1-regular text-text-tertiary">
                —
              </span>
            ) : (
              row.loginMethods.map((method) => (
                <Chip
                  key={method.providerId}
                  variant="caption"
                  color={METHOD_CHIP_COLOR[method.kind]}
                >
                  {method.label}
                </Chip>
              ))
            )}
            {row.passkeyCount > 0 ? (
              <Chip variant="caption" color="cyan">
                Passkey{row.passkeyCount > 1 ? ` ×${row.passkeyCount}` : ''}
              </Chip>
            ) : null}
          </div>
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
