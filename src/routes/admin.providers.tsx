import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RiAddLine,
  RiDeleteBinLine,
  RiEditLine,
  RiFileCopyLine,
  RiKey2Line,
  RiRefreshLine,
} from '@remixicon/react'

import { Button } from '#/components/base/buttons/button'
import { Chip } from '#/components/base/badges/chip'
import { Checkbox } from '#/components/base/checkbox/checkbox'
import { Input } from '#/components/base/input/input'
import {
  AlertDialog,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '#/components/base/modal/modal'
import { Select, SelectItem } from '#/components/base/select/select'
import { Switch } from '#/components/base/switch/switch'
import { Spinner } from '#/components/base/spinner/spinner'
import { toast } from '#/components/base/toast/toast'
import { Divider } from '#/components/base/divider/divider'
import { ErrorState } from '#/components/application/errors/error-state'
import { EmptyHint, PageSection } from '#/components/admin/ui'
import {
  adminCreateProviderFn,
  adminCreateWebhookFn,
  adminDeleteProviderFn,
  adminDeleteWebhookFn,
  adminDiscoverProviderDomainsFn,
  adminImportProviderDomainsFn,
  adminListProvidersFn,
  adminListWebhooksFn,
  adminUpdateProviderFn,
  adminUpdateWebhookFn,
} from '#/server/fns/admin'
import { unwrap } from '#/lib/api'
import { queryKeys } from '#/lib/query-keys'

export const Route = createFileRoute('/admin/providers')({
  head: () => ({ meta: [{ title: '服务商 · 管理后台' }] }),
  component: AdminProviders,
})

type ProvidersResult = Awaited<ReturnType<typeof adminListProvidersFn>>
type ProviderRow = Extract<ProvidersResult, { ok: true }>['data'][number]
type WebhooksResult = Awaited<ReturnType<typeof adminListWebhooksFn>>
type WebhookRow = Extract<WebhooksResult, { ok: true }>['data'][number]

type DiscoveredDomain = {
  providerDomainId: string
  hostname: string
  status: string
}

type DiscoveryState = {
  providerId: string
  providerLabel: string
  domains: DiscoveredDomain[]
  selected: string[]
}

const DOMAIN_STATUS_LABEL: Record<string, string> = {
  pending: '待验证',
  verified: '已验证',
  failed: '验证失败',
  disabled: '已停用',
}

const DOMAIN_STATUS_COLOR: Record<string, 'lime' | 'rose' | 'yellow' | 'gray'> =
  {
    pending: 'yellow',
    verified: 'lime',
    failed: 'rose',
    disabled: 'gray',
  }

function AdminProviders() {
  const queryClient = useQueryClient()
  const [providerOpen, setProviderOpen] = useState(false)
  const [webhookOpen, setWebhookOpen] = useState(false)
  const [discovery, setDiscovery] = useState<DiscoveryState | null>(null)
  const [discoveringId, setDiscoveringId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [deletingProvider, setDeletingProvider] = useState<ProviderRow | null>(
    null,
  )
  const [deletingWebhook, setDeletingWebhook] = useState<WebhookRow | null>(
    null,
  )
  const [editingProvider, setEditingProvider] = useState<ProviderRow | null>(
    null,
  )
  const [editingWebhook, setEditingWebhook] = useState<WebhookRow | null>(null)

  const providers = useQuery({
    queryKey: queryKeys.admin.providers,
    queryFn: async () => unwrap(await adminListProvidersFn()),
  })
  const webhooks = useQuery({
    queryKey: queryKeys.admin.webhooks,
    queryFn: async () => unwrap(await adminListWebhooksFn()),
  })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.providers })
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.webhooks })
  }

  async function setDefault(id: string, value: boolean) {
    setPendingId(id)
    const result = await adminUpdateProviderFn({
      data: { id, isDefaultForSend: value },
    })
    setPendingId(null)
    if (!result.ok) {
      toast.error(result.error.message)
      throw new Error(result.error.message)
    }
    await refresh()
  }

  async function toggleWebhook(item: WebhookRow, enabled: boolean) {
    // 乐观更新：Turso 延迟下开关不会停在原位
    queryClient.setQueryData<WebhookRow[]>(queryKeys.admin.webhooks, (old) =>
      old
        ? old.map((row) => (row.id === item.id ? { ...row, enabled } : row))
        : old,
    )
    const result = await adminUpdateWebhookFn({
      data: { id: item.id, enabled },
    })
    if (!result.ok) {
      toast.error(result.error.message)
      queryClient.setQueryData<WebhookRow[]>(queryKeys.admin.webhooks, (old) =>
        old
          ? old.map((row) =>
              row.id === item.id ? { ...row, enabled: item.enabled } : row,
            )
          : old,
      )
      return
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.webhooks })
  }

  async function removeProvider() {
    if (!deletingProvider) return
    const result = await adminDeleteProviderFn({
      data: { id: deletingProvider.id },
    })
    if (!result.ok) {
      toast.error(result.error.message)
      throw new Error(result.error.message)
    }
    toast.success('服务商已删除')
    setDeletingProvider(null)
    await refresh()
  }

  async function removeWebhook() {
    if (!deletingWebhook) return
    const result = await adminDeleteWebhookFn({
      data: { id: deletingWebhook.id },
    })
    if (!result.ok) {
      toast.error(result.error.message)
      throw new Error(result.error.message)
    }
    toast.success('Webhook 端点已删除')
    setDeletingWebhook(null)
    await refresh()
  }

  function openDiscovery(
    providerId: string,
    providerLabel: string,
    domains: DiscoveredDomain[],
  ) {
    if (domains.length === 0) {
      toast.info(`${providerLabel} 账号下没有需要添加的新域名`)
      return
    }
    setDiscovery({
      providerId,
      providerLabel,
      domains,
      selected: domains.map((item) => item.providerDomainId),
    })
  }

  async function discover(providerId: string, providerLabel: string) {
    setDiscoveringId(providerId)
    const result = await adminDiscoverProviderDomainsFn({
      data: { providerConfigId: providerId },
    })
    setDiscoveringId(null)
    if (!result.ok) {
      toast.error(`发现域名失败：${result.error.message}`)
      return
    }
    openDiscovery(providerId, providerLabel, result.data.domains)
  }

  function toggleDiscovered(id: string, selected: boolean) {
    setDiscovery((prev) =>
      prev
        ? {
            ...prev,
            selected: selected
              ? Array.from(new Set([...prev.selected, id]))
              : prev.selected.filter((item) => item !== id),
          }
        : prev,
    )
  }

  function toggleAllDiscovered(selected: boolean) {
    setDiscovery((prev) =>
      prev
        ? {
            ...prev,
            selected: selected
              ? prev.domains.map((item) => item.providerDomainId)
              : [],
          }
        : prev,
    )
  }

  async function importSelected() {
    if (!discovery || discovery.selected.length === 0) return
    setImporting(true)
    const result = await adminImportProviderDomainsFn({
      data: {
        providerConfigId: discovery.providerId,
        providerDomainIds: discovery.selected,
      },
    })
    setImporting(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(`已添加 ${result.data.imported} 个域名`)
    setDiscovery(null)
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.domains })
  }

  return (
    <div className="flex flex-col gap-5">
      <PageSection
        title="服务商"
        description="保存后密钥仅用于调用服务商 API，界面只显示末四位"
        actions={
          <Button leadingIcon={RiAddLine} onClick={() => setProviderOpen(true)}>
            添加服务商
          </Button>
        }
      >
        {providers.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner className="size-5" />
          </div>
        ) : null}
        {providers.isError ? (
          <ErrorState
            error={providers.error}
            title="服务商列表加载失败"
            onRetry={() => void providers.refetch()}
          />
        ) : null}
        {!providers.isLoading &&
        !providers.isError &&
        (providers.data ?? []).length === 0 ? (
          <EmptyHint>还没有服务商，先添加一个 Resend API Key</EmptyHint>
        ) : null}

        <div className="flex flex-col gap-3">
          {(providers.data ?? []).map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-button-default p-4"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="flex size-9 items-center justify-center rounded-xl bg-accent-50 text-accent-700">
                  <RiKey2Line className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-body-medium text-text-primary">
                    {item.label}
                  </p>
                  <p className="text-caption-1-regular text-text-tertiary">
                    {item.kind} · 末四位 {item.apiKeyLast4 ?? '****'} ·{' '}
                    {[
                      item.capabilities.send ? '发件' : null,
                      item.capabilities.receive ? '收件' : null,
                      item.capabilities.domainApi ? '域名 API' : null,
                    ]
                      .filter(Boolean)
                      .join(' / ')}
                  </p>
                </div>
                <Chip color={item.status === 'active' ? 'lime' : 'rose'}>
                  {item.status}
                </Chip>
                {item.isDefaultForSend ? (
                  <Chip color="blue">默认发件</Chip>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {item.capabilities.domainApi ? (
                  <Button
                    size="small"
                    variant="secondary"
                    leadingIcon={RiRefreshLine}
                    onClick={() => void discover(item.id, item.label)}
                    disabled={discoveringId === item.id}
                  >
                    {discoveringId === item.id ? '读取中…' : '发现域名'}
                  </Button>
                ) : null}
                <label className="flex items-center gap-2 text-caption-1-regular text-text-secondary">
                  默认发件
                  <Switch
                    isSelected={item.isDefaultForSend}
                    isDisabled={pendingId === item.id}
                    onChange={(value) => {
                      void setDefault(item.id, value).catch(() => undefined)
                    }}
                  />
                </label>
                <Button
                  size="small"
                  variant="secondary"
                  leadingIcon={RiEditLine}
                  onClick={() => setEditingProvider(item)}
                >
                  编辑
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  aria-label={`删除服务商 ${item.label}`}
                  onClick={() => setDeletingProvider(item)}
                >
                  <RiDeleteBinLine className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </PageSection>

      <PageSection
        title="收件 Webhook"
        description="在服务商控制台创建 Webhook，把下面的 URL 填进去，再把签名密钥粘贴回来"
        actions={
          <Button
            variant="secondary"
            leadingIcon={RiAddLine}
            onClick={() => setWebhookOpen(true)}
          >
            新建端点
          </Button>
        }
      >
        {webhooks.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-5" />
          </div>
        ) : null}
        {webhooks.isError ? (
          <ErrorState
            error={webhooks.error}
            title="Webhook 列表加载失败"
            onRetry={() => void webhooks.refetch()}
          />
        ) : null}
        {!webhooks.isLoading &&
        !webhooks.isError &&
        (webhooks.data ?? []).length === 0 ? (
          <EmptyHint>还没有 Webhook 端点。收件必须配置端点才能入库。</EmptyHint>
        ) : null}

        <div className="flex flex-col gap-4">
          {(webhooks.data ?? []).map((item) => {
            const path = `/api/webhooks/${item.providerKind}/${item.id}`
            return (
              <div
                key={item.id}
                className="rounded-2xl border border-border-button-default p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="min-w-0 break-all text-body-medium text-text-primary">
                      {item.label}
                    </p>
                    <Chip color="gray">{item.providerLabel}</Chip>
                    <Chip color={item.enabled ? 'lime' : 'rose'}>
                      {item.enabled ? '启用' : '停用'}
                    </Chip>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-caption-1-regular text-text-tertiary">
                      已收 {item.eventCount} 个事件
                    </span>
                    <label className="flex items-center gap-1.5 text-caption-1-regular text-text-secondary">
                      启用
                      <Switch
                        size="sm"
                        isSelected={item.enabled}
                        onChange={(enabled) =>
                          void toggleWebhook(item, enabled)
                        }
                      />
                    </label>
                    <Button
                      size="small"
                      variant="secondary"
                      leadingIcon={RiFileCopyLine}
                      onClick={async () => {
                        await navigator.clipboard.writeText(
                          `${window.location.origin}${path}`,
                        )
                        toast.success('Webhook URL 已复制')
                      }}
                    >
                      复制 URL
                    </Button>
                    <Button
                      size="small"
                      variant="secondary"
                      leadingIcon={RiEditLine}
                      onClick={() => setEditingWebhook(item)}
                    >
                      编辑
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      aria-label={`删除 Webhook ${item.label}`}
                      onClick={() => setDeletingWebhook(item)}
                    >
                      <RiDeleteBinLine className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
                <p className="mt-3 break-all rounded-lg bg-background-tertiary-default px-3 py-2 font-mono text-caption-1-regular text-text-secondary">
                  {path}
                </p>
              </div>
            )
          })}
        </div>
      </PageSection>

      <AddProviderModal
        open={providerOpen}
        onOpenChange={setProviderOpen}
        onCreated={() => void refresh()}
        onDiscovered={openDiscovery}
      />
      <AddWebhookModal
        open={webhookOpen}
        onOpenChange={setWebhookOpen}
        providers={providers.data ?? []}
        onCreated={() => void refresh()}
      />
      <DiscoveryModal
        state={discovery}
        importing={importing}
        onOpenChange={(open) => {
          if (!open) setDiscovery(null)
        }}
        onToggle={toggleDiscovered}
        onToggleAll={toggleAllDiscovered}
        onImport={() => void importSelected()}
      />

      <EditProviderModal
        provider={editingProvider}
        onOpenChange={(open) => {
          if (!open) setEditingProvider(null)
        }}
        onSaved={() => void refresh()}
      />

      <EditWebhookModal
        webhook={editingWebhook}
        onOpenChange={(open) => {
          if (!open) setEditingWebhook(null)
        }}
        onSaved={() => void refresh()}
      />

      <AlertDialog
        isOpen={Boolean(deletingProvider)}
        onOpenChange={(open) => {
          if (!open) setDeletingProvider(null)
        }}
        title="删除服务商"
        description={
          deletingProvider
            ? `确定删除「${deletingProvider.label}」吗？仍有域名绑定时会被拒绝。`
            : ''
        }
        confirmLabel="删除"
        cancelLabel="取消"
        pendingLabel="删除中…"
        onConfirm={removeProvider}
      />

      <AlertDialog
        isOpen={Boolean(deletingWebhook)}
        onOpenChange={(open) => {
          if (!open) setDeletingWebhook(null)
        }}
        title="删除 Webhook 端点"
        description={
          deletingWebhook
            ? `确定删除「${deletingWebhook.label}」吗？删除后该地址立即停止接收事件。`
            : ''
        }
        confirmLabel="删除"
        cancelLabel="取消"
        pendingLabel="删除中…"
        onConfirm={removeWebhook}
      />
    </div>
  )
}

type ProviderKind =
  | 'resend'
  | 'unitpost'
  | 'ahasend'
  | 'groundmail'
  | 'mailtrap'
  | 'plunk'
  | 'reloop'
  | 'custom'

const PROVIDER_KINDS: {
  id: ProviderKind
  label: string
  name: string
  keyPlaceholder: string
  hint: string
  needsAccountId?: boolean
  needsBaseUrl?: boolean
}[] = [
  {
    id: 'resend',
    label: 'Resend',
    name: 'Resend',
    keyPlaceholder: 're_...',
    hint: '发件、收件、域名与 Webhook 全支持；建议只授予发件/收件/域名权限',
  },
  {
    id: 'unitpost',
    label: 'UnitPost',
    name: 'UnitPost',
    keyPlaceholder: '粘贴 API Key',
    hint: '收件需在域名 Receiving 里开启并发布 MX；Webhook 订阅 email.received',
  },
  {
    id: 'ahasend',
    label: 'AhaSend',
    name: 'AhaSend',
    keyPlaceholder: 'aha-sk-...',
    hint: '必须同时填写 Account ID（账号 UUID）；收件在 Routes 里配置',
    needsAccountId: true,
  },
  {
    id: 'groundmail',
    label: 'Groundmail',
    name: 'Groundmail',
    keyPlaceholder: 'gm_...',
    hint: '发信兼容 Resend 字段；入站需在控制台开启并把 MX 指向 mx.groundmail.dev，务必用子域',
  },
  {
    id: 'mailtrap',
    label: 'Mailtrap',
    name: 'Mailtrap',
    keyPlaceholder: '粘贴 Mailtrap API Token',
    hint: '发信走 send.api.mailtrap.io；收件需在 Mailtrap 建 Inbound 收件箱并绑定域名、发布 MX，Webhook 订阅 Inbound Inboxes',
  },
  {
    id: 'plunk',
    label: 'Plunk',
    name: 'Plunk',
    keyPlaceholder: 'sk_...',
    hint: '填 Secret Key（sk_ 开头）。收件要在域名发布入站 MX，并在 Plunk 建 email.received 工作流、Webhook 步骤指向本站端点；自建实例需填 API Base URL',
  },
  {
    id: 'reloop',
    label: 'Reloop',
    name: 'Reloop',
    keyPlaceholder: 'rl_...',
    hint: '填 API Key（rl_ 开头）。收件需在域名开启 receiving 并发布 Reloop 给的 MX，Webhook 订阅 email.received；正文由本站按 email_id 回查 inbox 接口',
  },
  {
    id: 'custom',
    label: '兼容 Resend 协议',
    name: '自定义网关',
    keyPlaceholder: 're_...',
    hint: '必须填写 API Base URL，例如 https://mail.example.com',
    needsBaseUrl: true,
  },
]

function AddProviderModal({
  open,
  onOpenChange,
  onCreated,
  onDiscovered,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
  onDiscovered: (
    providerId: string,
    providerLabel: string,
    domains: DiscoveredDomain[],
  ) => void
}) {
  const [kind, setKind] = useState<ProviderKind>('resend')
  const [label, setLabel] = useState('Resend')
  const [apiKey, setApiKey] = useState('')
  const [accountId, setAccountId] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'saving' | 'discovering'>('idle')

  const meta =
    PROVIDER_KINDS.find((item) => item.id === kind) ?? PROVIDER_KINDS[0]

  function changeKind(next: ProviderKind) {
    const found = PROVIDER_KINDS.find((item) => item.id === next)
    if (!found) return
    // 名称还是预设值时跟着切换，用户改过就保留
    if (PROVIDER_KINDS.some((item) => item.name === label)) {
      setLabel(found.name)
    }
    setKind(next)
  }

  async function submit() {
    if (!apiKey.trim()) {
      toast.error('请填写 API Key')
      return
    }
    if (meta.needsAccountId && !accountId.trim()) {
      toast.error(`${meta.label} 需要填写 Account ID`)
      return
    }
    if (meta.needsBaseUrl && !apiBaseUrl.trim()) {
      toast.error('自定义网关需要填写 API Base URL')
      return
    }
    const providerLabel = label.trim() || meta.name
    setPhase('saving')
    const result = await adminCreateProviderFn({
      data: {
        kind,
        label: providerLabel,
        apiKey: apiKey.trim(),
        accountId: meta.needsAccountId ? accountId.trim() : null,
        apiBaseUrl: apiBaseUrl.trim() || null,
        isDefaultForSend: isDefault,
      },
    })
    if (!result.ok) {
      setPhase('idle')
      toast.error(result.error.message)
      return
    }

    toast.success('服务商已添加')
    onCreated()

    // 保存成功后立刻按账号读一次域名，失败不阻塞服务商创建
    setPhase('discovering')
    const discovered = await adminDiscoverProviderDomainsFn({
      data: { providerConfigId: result.data.id },
    })
    setPhase('idle')
    setApiKey('')
    setAccountId('')
    setApiBaseUrl('')
    onOpenChange(false)

    if (!discovered.ok) {
      toast.error(`未能自动发现域名：${discovered.error.message}`)
      return
    }
    onDiscovered(result.data.id, providerLabel, discovered.data.domains)
  }

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      {(renderProps) => (
        <>
          <ModalHeader
            title="添加服务商"
            description="密钥加密存储，界面只显示末四位；各家接入步骤见 docs/ 目录"
          />
          <ModalBody className="flex flex-col gap-4">
            <Select
              label="类型"
              selectedKey={kind}
              onSelectionChange={(key) => changeKind(key as ProviderKind)}
            >
              {PROVIDER_KINDS.map((item) => (
                <SelectItem key={item.id} id={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </Select>
            <Input label="名称" value={label} onChange={setLabel} />
            <Input
              label="API Key"
              placeholder={meta.keyPlaceholder}
              type="password"
              value={apiKey}
              onChange={setApiKey}
              inputDir="ltr"
              hint="保存后不可回显，仅显示末四位"
            />
            {meta.needsAccountId ? (
              <Input
                label="Account ID"
                placeholder="00000000-0000-0000-0000-000000000000"
                value={accountId}
                onChange={setAccountId}
                inputDir="ltr"
                hint="AhaSend 控制台 → 设置里的账号 UUID，所有 API 路径都需要它"
              />
            ) : null}
            {meta.needsBaseUrl ? (
              <Input
                label="API Base URL"
                placeholder="https://mail.example.com"
                value={apiBaseUrl}
                onChange={setApiBaseUrl}
                inputDir="ltr"
                hint="兼容 Resend 协议的自建网关地址"
              />
            ) : null}
            <p className="text-caption-1-regular text-text-tertiary">
              {meta.hint}
            </p>
            <label className="flex items-center justify-between gap-2">
              <span className="text-body-regular text-text-secondary">
                设为默认发件服务商
              </span>
              <Switch isSelected={isDefault} onChange={setIsDefault} />
            </label>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={renderProps.close}>
              取消
            </Button>
            <Button onClick={submit} disabled={phase !== 'idle'}>
              {phase === 'saving'
                ? '保存中…'
                : phase === 'discovering'
                  ? '同步域名…'
                  : '保存'}
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  )
}

function DiscoveryModal({
  state,
  importing,
  onOpenChange,
  onToggle,
  onToggleAll,
  onImport,
}: {
  state: DiscoveryState | null
  importing: boolean
  onOpenChange: (open: boolean) => void
  onToggle: (id: string, selected: boolean) => void
  onToggleAll: (selected: boolean) => void
  onImport: () => void
}) {
  const allSelected = state
    ? state.domains.length > 0 && state.selected.length === state.domains.length
    : false
  const someSelected = state ? state.selected.length > 0 && !allSelected : false

  return (
    <Modal isOpen={Boolean(state)} onOpenChange={onOpenChange} size="lg">
      {(renderProps) =>
        state ? (
          <>
            <ModalHeader
              title="发现服务商域名"
              description={`${state.providerLabel} 账号下还有 ${state.domains.length} 个域名未添加到本站，勾选后可以直接使用`}
            />
            <ModalBody className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Checkbox
                  isSelected={allSelected}
                  isIndeterminate={someSelected}
                  onChange={onToggleAll}
                >
                  全选
                </Checkbox>
                <span className="text-caption-1-regular text-text-tertiary">
                  已选 {state.selected.length} / {state.domains.length}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {state.domains.map((item) => (
                  <div
                    key={item.providerDomainId}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border-button-default px-3 py-2"
                  >
                    <Checkbox
                      isSelected={state.selected.includes(
                        item.providerDomainId,
                      )}
                      onChange={(selected) =>
                        onToggle(item.providerDomainId, selected)
                      }
                    >
                      <span dir="ltr">{item.hostname}</span>
                    </Checkbox>
                    <Chip color={DOMAIN_STATUS_COLOR[item.status] ?? 'gray'}>
                      {DOMAIN_STATUS_LABEL[item.status] ?? item.status}
                    </Chip>
                  </div>
                ))}
              </div>
              <p className="text-caption-1-regular text-text-tertiary">
                导入时沿用服务商侧的验证状态与 DNS
                记录；邮箱新建权限默认开启，收发开关默认关闭，可在「域名」页调整。
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={renderProps.close}>
                暂不添加
              </Button>
              <Button
                onClick={onImport}
                disabled={importing || state.selected.length === 0}
              >
                {importing
                  ? '添加中…'
                  : `添加所选域名（${state.selected.length}）`}
              </Button>
            </ModalFooter>
          </>
        ) : null
      }
    </Modal>
  )
}

function AddWebhookModal({
  open,
  onOpenChange,
  providers,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  providers: { id: string; label: string; kind: string }[]
  onCreated: () => void
}) {
  const [providerId, setProviderId] = useState<string | null>(null)
  const [label, setLabel] = useState('收件回调')
  const [secret, setSecret] = useState('')
  const [loading, setLoading] = useState(false)

  const selectedKind =
    providers.find((item) => item.id === providerId)?.kind ?? 'resend'
  const secretHint =
    selectedKind === 'ahasend'
      ? 'AhaSend：事件用 aha-whsec-，入站路由用 aha-rsec-（原文粘贴，不要解码）'
      : selectedKind === 'unitpost'
        ? 'UnitPost：端点详情里的 svix 密钥，形如 whsec_...'
        : selectedKind === 'groundmail'
          ? 'Groundmail：创建端点时只返回一次的 secret，形如 whsec_...（原文粘贴，不要解码）'
          : selectedKind === 'mailtrap'
            ? 'Mailtrap：Webhook 详情里的 signing secret，32 位十六进制，原文粘贴'
            : selectedKind === 'plunk'
              ? 'Plunk：没有签名，填你在工作流 Webhook 步骤里自己写的 X-Plunk-Secret 值（原文粘贴）'
              : selectedKind === 'reloop'
                ? 'Reloop：Webhook 详情里的签名密钥，形如 whsec_...（原文粘贴，不要解码）'
                : 'Resend：Webhook 详情页的 Signing Secret，形如 whsec_...'

  async function submit() {
    if (!providerId || !secret.trim()) {
      toast.error('请选择服务商并填写签名密钥')
      return
    }
    setLoading(true)
    const result = await adminCreateWebhookFn({
      data: {
        providerConfigId: providerId,
        label: label.trim() || '收件回调',
        signingSecret: secret.trim(),
      },
    })
    setLoading(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('端点已创建，请复制 URL 填到服务商控制台')
    setSecret('')
    onCreated()
    onOpenChange(false)
  }

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      {(renderProps) => (
        <>
          <ModalHeader
            title="新建 Webhook 端点"
            description="端点 URL 会包含一段不可猜的 ID，配合签名校验使用"
          />
          <ModalBody className="flex flex-col gap-4">
            <Select
              label="服务商"
              placeholder="选择服务商"
              selectedKey={providerId}
              onSelectionChange={(key) => setProviderId(String(key))}
            >
              {providers.map((item) => (
                <SelectItem key={item.id} id={item.id} textValue={item.label}>
                  {item.label}
                </SelectItem>
              ))}
            </Select>
            <Input label="名称" value={label} onChange={setLabel} />
            <Input
              label="签名密钥"
              placeholder="whsec_..."
              type="password"
              value={secret}
              onChange={setSecret}
              inputDir="ltr"
              hint={secretHint}
            />
            <Divider />
            <p className="text-caption-1-regular text-text-tertiary">
              建议只订阅收件事件与投递状态事件，避免无关事件打到本站。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={renderProps.close}>
              取消
            </Button>
            <Button onClick={submit} disabled={loading}>
              {loading ? '创建中…' : '创建'}
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  )
}

function EditProviderModal({
  provider,
  onOpenChange,
  onSaved,
}: {
  provider: ProviderRow | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [status, setStatus] = useState<'active' | 'invalid' | 'disabled'>(
    'active',
  )
  const [isDefault, setIsDefault] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!provider) return
    setLabel(provider.label)
    setApiKey('')
    setApiBaseUrl(provider.apiBaseUrl ?? '')
    setStatus(
      provider.status === 'invalid' || provider.status === 'disabled'
        ? provider.status
        : 'active',
    )
    setIsDefault(provider.isDefaultForSend)
  }, [provider])

  async function submit() {
    if (!provider) return
    if (!label.trim()) {
      toast.error('请填写名称')
      return
    }
    setSaving(true)
    const result = await adminUpdateProviderFn({
      data: {
        id: provider.id,
        label: label.trim(),
        apiBaseUrl: apiBaseUrl.trim() || null,
        status,
        isDefaultForSend: isDefault,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      },
    })
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('服务商已更新')
    setApiKey('')
    onOpenChange(false)
    onSaved()
  }

  return (
    <Modal
      isOpen={Boolean(provider)}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false)
      }}
    >
      {({ close }) => (
        <>
          <ModalHeader
            title="编辑服务商"
            description="API Key 留空表示不修改；界面只显示末四位"
          />
          <ModalBody className="flex flex-col gap-4">
            <Input label="名称" value={label} onChange={setLabel} />
            <Input
              label="API Key"
              type="password"
              placeholder={
                provider?.apiKeyLast4
                  ? `已保存（末四位 ${provider.apiKeyLast4}），留空不修改`
                  : '填写新的 API Key'
              }
              value={apiKey}
              onChange={setApiKey}
              inputDir="ltr"
            />
            <Input
              label="API Base URL"
              placeholder="https://mail.example.com"
              value={apiBaseUrl}
              onChange={setApiBaseUrl}
              inputDir="ltr"
              hint="仅兼容 Resend 协议的自建网关需要"
            />
            <Select
              label="状态"
              selectedKey={status}
              onSelectionChange={(key) =>
                setStatus(key as 'active' | 'invalid' | 'disabled')
              }
            >
              <SelectItem id="active">正常</SelectItem>
              <SelectItem id="invalid">标记为无效</SelectItem>
              <SelectItem id="disabled">停用</SelectItem>
            </Select>
            <label className="flex items-center justify-between gap-2">
              <span className="text-body-regular text-text-secondary">
                设为默认发件服务商
              </span>
              <Switch isSelected={isDefault} onChange={setIsDefault} />
            </label>
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

function EditWebhookModal({
  webhook,
  onOpenChange,
  onSaved,
}: {
  webhook: WebhookRow | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!webhook) return
    setLabel(webhook.label)
    setSecret('')
    setEnabled(webhook.enabled)
  }, [webhook])

  async function submit() {
    if (!webhook) return
    if (!label.trim()) {
      toast.error('请填写名称')
      return
    }
    setSaving(true)
    const result = await adminUpdateWebhookFn({
      data: {
        id: webhook.id,
        label: label.trim(),
        enabled,
        ...(secret.trim() ? { signingSecret: secret.trim() } : {}),
      },
    })
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Webhook 已更新')
    setSecret('')
    onOpenChange(false)
    onSaved()
  }

  return (
    <Modal
      isOpen={Boolean(webhook)}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false)
      }}
    >
      {({ close }) => (
        <>
          <ModalHeader
            title="编辑 Webhook 端点"
            description="签名密钥留空表示不修改"
          />
          <ModalBody className="flex flex-col gap-4">
            <Input label="名称" value={label} onChange={setLabel} />
            <Input
              label="签名密钥"
              type="password"
              placeholder={webhook?.hasSecret ? '已保存，留空不修改' : ''}
              value={secret}
              onChange={setSecret}
              inputDir="ltr"
            />
            <label className="flex items-center justify-between gap-2">
              <span className="text-body-regular text-text-secondary">
                启用该端点
              </span>
              <Switch isSelected={enabled} onChange={setEnabled} />
            </label>
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
