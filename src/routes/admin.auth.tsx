import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RiAddLine,
  RiDeleteBinLine,
  RiEditLine,
  RiFingerprintLine,
  RiGithubLine,
  RiGoogleLine,
  RiLinkM,
  RiMailLine,
} from '@remixicon/react'

import { Button } from '@/components/base/buttons/button'
import { Chip } from '@/components/base/badges/chip'
import { Input } from '@/components/base/input/input'
import {
  AlertDialog,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@/components/base/modal/modal'
import { Select, SelectItem } from '@/components/base/select/select'
import { Spinner } from '@/components/base/spinner/spinner'
import { Switch } from '@/components/base/switch/switch'
import { toast } from '@/components/base/toast/toast'
import { EmptyHint, PageSection } from '@/components/admin/ui'
import { unwrap } from '#/lib/api'
import {
  adminCreateLoginMethodFn,
  adminDeleteLoginMethodFn,
  adminListLoginMethodsFn,
  adminSetEmailVerificationFn,
  adminUpdateLoginMethodFn,
} from '#/server/fns/admin'

export const Route = createFileRoute('/admin/auth')({
  component: AdminAuth,
})

type LoginMethodKind = 'email' | 'google' | 'github' | 'oidc' | 'passkey'

interface LoginMethodRow {
  id: string
  kind: string
  providerId: string
  displayName: string
  enabled: boolean
  clientId: string | null
  hasSecret: boolean
  issuer: string | null
  scopes: string | null
}

const METHOD_META: Record<
  LoginMethodKind,
  { label: string; icon: ComponentType<{ className?: string }>; hint: string }
> = {
  email: {
    label: '邮箱密码',
    icon: RiMailLine,
    hint: '默认开启，可随时删除或重新添加',
  },
  google: {
    label: 'Google',
    icon: RiGoogleLine,
    hint: '需要 Google OAuth 的 Client ID 与 Client Secret',
  },
  github: {
    label: 'GitHub',
    icon: RiGithubLine,
    hint: '需要 GitHub OAuth App 的 Client ID 与 Client Secret',
  },
  oidc: {
    label: '通用 OIDC',
    icon: RiLinkM,
    hint: '填写 Issuer 和自定义回调标识，可添加多个不同的 OIDC 服务商',
  },
  passkey: {
    label: 'Passkey',
    icon: RiFingerprintLine,
    hint: '使用当前站点域名作为 RP ID，需要 HTTPS 或 localhost',
  },
}

const METHOD_ORDER: LoginMethodKind[] = [
  'email',
  'google',
  'github',
  'oidc',
  'passkey',
]

function isOAuth(kind: string) {
  return kind === 'google' || kind === 'github' || kind === 'oidc'
}

const METHOD_META_BY_KIND = new Map<
  string,
  (typeof METHOD_META)[LoginMethodKind]
>(Object.entries(METHOD_META))

function methodMeta(kind: string) {
  return METHOD_META_BY_KIND.get(kind) ?? METHOD_META.oidc
}

function callbackPath(providerId: string) {
  return `/api/auth/callback/${providerId}`
}

function AdminAuth() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['admin', 'login-methods'],
    queryFn: async () => unwrap(await adminListLoginMethodsFn()),
  })

  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<LoginMethodRow | null>(null)
  const [deleting, setDeleting] = useState<LoginMethodRow | null>(null)

  const data = query.data
  const methods = data?.methods ?? []
  const usedKinds = new Set(methods.map((item) => item.kind))
  // 通用 OIDC 支持多条，始终可以继续添加
  const available = METHOD_ORDER.filter(
    (kind) => kind === 'oidc' || !usedKinds.has(kind),
  )

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: ['admin', 'login-methods'],
    })
  }

  async function toggle(method: LoginMethodRow, enabled: boolean) {
    const result = await adminUpdateLoginMethodFn({
      data: { id: method.id, enabled },
    })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(enabled ? '已启用' : '已停用')
    await refresh()
  }

  async function setVerification(enabled: boolean) {
    const result = await adminSetEmailVerificationFn({ data: { enabled } })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(enabled ? '邮箱验证已开启' : '邮箱验证已关闭')
    await refresh()
  }

  async function remove() {
    if (!deleting) return
    const result = await adminDeleteLoginMethodFn({ data: { id: deleting.id } })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('登录方式已删除')
    setDeleting(null)
    await refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      <PageSection
        title="登录方式"
        description="配置用户可以用哪些方式登录，至少保留一种。回调地址为 {站点地址}/api/auth/callback/{providerId}"
        actions={
          <Button
            leadingIcon={RiAddLine}
            onClick={() => setAddOpen(true)}
            disabled={query.isLoading || available.length === 0}
          >
            添加登录方式
          </Button>
        }
      >
        {query.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="size-5" />
          </div>
        ) : null}

        {!query.isLoading && methods.length === 0 ? (
          <EmptyHint>还没有登录方式，先添加一种</EmptyHint>
        ) : null}

        <div className="flex flex-col gap-3">
          {methods.map((method) => {
            const meta = methodMeta(method.kind)
            const Icon = meta.icon
            const detail = isOAuth(method.kind)
              ? [
                  method.kind === 'oidc'
                    ? `回调 ${callbackPath(method.providerId)}`
                    : method.clientId
                      ? `Client ID 末四位 ${method.clientId.slice(-4)}`
                      : '未填写 Client ID',
                  method.issuer ?? null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : method.kind === 'email'
                ? `邮箱验证：${data?.emailVerification.enabled ? '开' : '关'}`
                : meta.hint

            return (
              <div
                key={method.id}
                className="flex flex-col gap-3 rounded-2xl border border-border-button-default p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-accent-50 text-accent-700">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-body-medium text-text-primary">
                        {method.displayName || meta.label}
                      </p>
                      <p className="truncate text-caption-1-regular text-text-tertiary">
                        {detail}
                      </p>
                    </div>
                    <Chip color={method.enabled ? 'lime' : 'gray'}>
                      {method.enabled ? '已启用' : '已停用'}
                    </Chip>
                    {method.hasSecret ? <Chip color="blue">已配置</Chip> : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-caption-1-regular text-text-secondary">
                      启用
                      <Switch
                        isSelected={method.enabled}
                        onChange={(value) => void toggle(method, value)}
                      />
                    </label>
                    {isOAuth(method.kind) ? (
                      <Button
                        size="small"
                        variant="secondary"
                        leadingIcon={RiEditLine}
                        onClick={() => setEditing(method)}
                      >
                        编辑
                      </Button>
                    ) : null}
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={() => setDeleting(method)}
                    >
                      <RiDeleteBinLine className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>

                {method.kind === 'email' ? (
                  <div className="flex flex-col gap-1 border-t border-separator-border pt-3">
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-body-regular text-text-secondary">
                        开启邮箱验证
                      </span>
                      <Switch
                        isSelected={data?.emailVerification.enabled ?? false}
                        onChange={(value) => void setVerification(value)}
                        isDisabled={
                          !data?.emailVerification.canSend &&
                          !data?.emailVerification.enabled
                        }
                      />
                    </label>
                    <p className="text-caption-1-regular text-text-tertiary">
                      {data?.emailVerification.canSend
                        ? '开启后未验证用户登录会被引导到验证页，验证前无法进入邮箱。'
                        : '请先在「服务商」配置可发信的已验证域名，才能开启邮箱验证。'}
                    </p>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </PageSection>

      <AddMethodModal
        open={addOpen}
        onOpenChange={setAddOpen}
        available={available}
        onCreated={() => void refresh()}
      />

      <EditMethodModal
        method={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        onSaved={() => void refresh()}
      />

      <AlertDialog
        isOpen={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="删除登录方式"
        description={
          deleting
            ? `确定删除「${deleting.displayName || methodMeta(deleting.kind).label}」吗？该方式的用户凭证会保留，重新添加后可继续登录。`
            : ''
        }
        confirmLabel="删除"
        cancelLabel="取消"
        pendingLabel="删除中…"
        onConfirm={remove}
      />
    </div>
  )
}

/* --------------------------------------------------------------- add modal */

function AddMethodModal({
  open,
  onOpenChange,
  available,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  available: LoginMethodKind[]
  onCreated: () => void
}) {
  const [kind, setKind] = useState<LoginMethodKind>('google')
  const [providerId, setProviderId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [issuer, setIssuer] = useState('')
  const [scopes, setScopes] = useState('')
  const [saving, setSaving] = useState(false)

  const fallback: LoginMethodKind | undefined = available.at(0)
  const selected: LoginMethodKind | undefined = available.includes(kind)
    ? kind
    : fallback
  const meta = selected ? methodMeta(selected) : methodMeta('google')
  const isOidc = selected === 'oidc'

  function reset() {
    setProviderId('')
    setDisplayName('')
    setClientId('')
    setSecret('')
    setIssuer('')
    setScopes('')
  }

  async function submit() {
    if (!selected) return
    if (isOAuth(selected)) {
      if (isOidc && !providerId.trim()) {
        toast.error('请填写回调标识')
        return
      }
      if (
        isOidc &&
        !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(providerId)
      ) {
        toast.error('回调标识只能包含小写字母、数字和中划线，长度 1–40')
        return
      }
      if (!clientId.trim()) {
        toast.error('请填写 Client ID')
        return
      }
      if (!secret.trim()) {
        toast.error('请填写 Client Secret')
        return
      }
      if (isOidc && !issuer.trim()) {
        toast.error('请填写 OIDC Issuer')
        return
      }
      if (isOidc && !displayName.trim()) {
        toast.error('请填写名称')
        return
      }
    }

    setSaving(true)
    const result = await adminCreateLoginMethodFn({
      data: {
        kind: selected,
        providerId: isOidc ? providerId.trim() : undefined,
        displayName: displayName.trim() || undefined,
        clientId: isOAuth(selected) ? clientId.trim() : null,
        clientSecret: isOAuth(selected) ? secret.trim() : undefined,
        issuer: isOidc ? issuer.trim() : null,
        scopes: scopes.trim() || null,
      },
    })
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('登录方式已添加')
    reset()
    onOpenChange(false)
    onCreated()
  }

  return (
    <Modal
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
      size="md"
    >
      {({ close }) => (
        <>
          <ModalHeader
            title="添加登录方式"
            description="添加后立即生效，登录页会在 30–60 秒内更新"
          />
          <ModalBody className="flex flex-col gap-3">
            <Select
              label="类型"
              selectedKey={selected ?? null}
              onSelectionChange={(key) => {
                setKind(key as LoginMethodKind)
                setProviderId('')
              }}
            >
              {available.map((id) => (
                <SelectItem key={id} id={id}>
                  {METHOD_META[id].label}
                </SelectItem>
              ))}
            </Select>

            <p className="text-caption-1-regular text-text-tertiary">
              {meta.hint}
            </p>

            {isOAuth(selected ?? '') ? (
              <>
                {isOidc ? (
                  <>
                    <Input
                      label="名称"
                      placeholder="例如：公司 SSO"
                      value={displayName}
                      onChange={setDisplayName}
                      isRequired
                    />
                    <Input
                      label="回调标识"
                      placeholder="company-sso"
                      value={providerId}
                      onChange={(value) =>
                        setProviderId(
                          value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                        )
                      }
                      inputDir="ltr"
                      hint={`回调地址：${callbackPath(providerId || 'your-id')}`}
                      isRequired
                    />
                    <Input
                      label="Issuer"
                      placeholder="https://id.example.com"
                      value={issuer}
                      onChange={setIssuer}
                      inputDir="ltr"
                      hint="会自动拼接 /.well-known/openid-configuration"
                      isRequired
                    />
                  </>
                ) : null}
                <Input
                  label="Client ID"
                  value={clientId}
                  onChange={setClientId}
                  inputDir="ltr"
                  isRequired
                />
                <Input
                  label="Client Secret"
                  type="password"
                  value={secret}
                  onChange={setSecret}
                  inputDir="ltr"
                  hint="保存后不可回显"
                  isRequired
                />
                <Input
                  label="Scopes（可选）"
                  placeholder="openid email profile"
                  value={scopes}
                  onChange={setScopes}
                  inputDir="ltr"
                />
              </>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={close}>
              取消
            </Button>
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? '保存中…' : '添加'}
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  )
}

/* -------------------------------------------------------------- edit modal */

function EditMethodModal({
  method,
  onOpenChange,
  onSaved,
}: {
  method: LoginMethodRow | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [displayName, setDisplayName] = useState('')
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [issuer, setIssuer] = useState('')
  const [scopes, setScopes] = useState('')
  const [saving, setSaving] = useState(false)

  const meta = method ? methodMeta(method.kind) : null
  const isOidc = method?.kind === 'oidc'
  const providerIdForCallback = method?.providerId ?? ''

  useEffect(() => {
    if (!method) return
    setDisplayName(method.displayName)
    setClientId(method.clientId ?? '')
    setIssuer(method.issuer ?? '')
    setScopes(method.scopes ?? '')
    setSecret('')
  }, [method])

  async function submit() {
    if (!method) return
    setSaving(true)
    const result = await adminUpdateLoginMethodFn({
      data: {
        id: method.id,
        displayName: displayName.trim() || undefined,
        clientId: isOAuth(method.kind) ? clientId.trim() || null : undefined,
        clientSecret: secret.trim() || undefined,
        issuer: isOidc ? issuer.trim() || null : undefined,
        scopes: scopes.trim() || null,
      },
    })
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('登录方式已更新')
    setSecret('')
    onOpenChange(false)
    onSaved()
  }

  return (
    <Modal
      isOpen={Boolean(method)}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false)
      }}
      size="md"
    >
      {({ close }) => (
        <>
          <ModalHeader
            title={`编辑 ${meta?.label ?? '登录方式'}`}
            description="Client Secret 留空表示不修改"
          />
          <ModalBody className="flex flex-col gap-3">
            <Input label="名称" value={displayName} onChange={setDisplayName} />
            <Input
              label="Client ID"
              value={clientId}
              onChange={setClientId}
              inputDir="ltr"
            />
            <Input
              label="Client Secret"
              type="password"
              placeholder={method?.hasSecret ? '已保存，留空不修改' : ''}
              value={secret}
              onChange={setSecret}
              inputDir="ltr"
            />
            {isOidc ? (
              <>
                <p className="rounded-lg bg-background-secondary-default px-3 py-2 text-caption-1-regular text-text-tertiary">
                  回调地址：
                  <span dir="ltr" className="text-text-secondary">
                    {callbackPath(providerIdForCallback)}
                  </span>
                </p>
                <Input
                  label="Issuer"
                  value={issuer}
                  onChange={setIssuer}
                  inputDir="ltr"
                  hint="会自动拼接 /.well-known/openid-configuration"
                />
              </>
            ) : null}
            <Input
              label="Scopes（可选）"
              value={scopes}
              onChange={setScopes}
              inputDir="ltr"
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={close}>
              取消
            </Button>
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  )
}
