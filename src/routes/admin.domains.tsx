import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RiAddLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiRefreshLine,
} from '@remixicon/react'

import { Button } from '#/components/base/buttons/button'
import { Chip } from '#/components/base/badges/chip'
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
import { ErrorState } from '#/components/application/errors/error-state'
import { EmptyHint, PageSection } from '#/components/admin/ui'
import {
  adminCreateDomainFn,
  adminDeleteDomainFn,
  adminListDomainsFn,
  adminListProvidersFn,
  adminUpdateDomainFn,
  adminVerifyDomainFn,
} from '#/server/fns/admin'
import { unwrap } from '#/lib/api'
import { queryKeys } from '#/lib/query-keys'

export const Route = createFileRoute('/admin/domains')({
  head: () => ({ meta: [{ title: '域名 · 管理后台' }] }),
  component: AdminDomains,
})

const STATUS_LABEL: Record<string, string> = {
  pending: '待验证',
  verified: '已验证',
  failed: '验证失败',
  disabled: '已停用',
}

interface DnsRecordView {
  type: string
  name: string
  value: string
  priority?: number
}

/** 历史数据里的 JSON 可能损坏，不能让整个域名页跟着崩溃 */
function parseDnsRecords(json: string | null): DnsRecordView[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as DnsRecordView[]) : []
  } catch {
    return []
  }
}

function AdminDomains() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{
    id: string
    hostname: string
  } | null>(null)

  const domains = useQuery({
    queryKey: queryKeys.admin.domains,
    queryFn: async () => unwrap(await adminListDomainsFn()),
  })
  const providers = useQuery({
    queryKey: queryKeys.admin.providers,
    queryFn: async () => unwrap(await adminListProvidersFn()),
  })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.domains })
  }

  async function verify(id: string) {
    setBusy(id)
    const result = await adminVerifyDomainFn({ data: { id } })
    setBusy(null)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(
      `验证状态：${STATUS_LABEL[result.data.status] ?? result.data.status}`,
    )
    await refresh()
  }

  async function update(id: string, patch: Record<string, unknown>) {
    const result = await adminUpdateDomainFn({ data: { id, ...patch } })
    if (!result.ok) {
      toast.error(result.error.message)
      throw new Error(result.error.message)
    }
    await refresh()
  }

  async function remove() {
    if (!deleting) return
    const result = await adminDeleteDomainFn({ data: { id: deleting.id } })
    if (!result.ok) {
      toast.error(result.error.message)
      throw new Error(result.error.message)
    }
    toast.success('域名已删除')
    setDeleting(null)
    await refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      <PageSection
        title="域名"
        description="域名必须在服务商侧验证通过，才能用于收件与发件"
        actions={
          <Button leadingIcon={RiAddLine} onClick={() => setOpen(true)}>
            添加域名
          </Button>
        }
      >
        {domains.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner className="size-5" />
          </div>
        ) : null}

        {domains.isError ? (
          <ErrorState
            error={domains.error}
            title="域名列表加载失败"
            onRetry={() => void domains.refetch()}
          />
        ) : null}

        {!domains.isLoading &&
        !domains.isError &&
        (domains.data ?? []).length === 0 ? (
          <EmptyHint>还没有域名，先添加一个用于收发的域名</EmptyHint>
        ) : null}

        <div className="flex flex-col gap-3">
          {(domains.data ?? []).map((item) => {
            const records = parseDnsRecords(item.dnsRecordsJson)
            return (
              <div
                key={item.id}
                className="rounded-2xl border border-border-button-default p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 break-all text-body-medium text-text-primary">
                      {item.hostname}
                    </span>
                    <Chip
                      color={
                        item.status === 'verified'
                          ? 'lime'
                          : item.status === 'failed'
                            ? 'rose'
                            : 'yellow'
                      }
                    >
                      {STATUS_LABEL[item.status] ?? item.status}
                    </Chip>
                    <Chip color="gray">{item.providerLabel}</Chip>
                    <Chip
                      color={item.allowPermanentCreate ? 'blue' : 'neutral'}
                    >
                      {item.allowPermanentCreate ? '可建长期' : '长期已关'}
                    </Chip>
                    <Chip color={item.allowTempCreate ? 'cyan' : 'neutral'}>
                      {item.allowTempCreate ? '可建临时' : '临时已关'}
                    </Chip>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="small"
                      variant="secondary"
                      leadingIcon={RiRefreshLine}
                      onClick={() => void verify(item.id)}
                      disabled={busy === item.id}
                    >
                      验证
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      aria-label={`删除域名 ${item.hostname}`}
                      onClick={() =>
                        setDeleting({
                          id: item.id,
                          hostname: item.hostname,
                        })
                      }
                    >
                      <RiDeleteBinLine className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <ToggleCell
                    label="允许新建长期邮箱"
                    value={item.allowPermanentCreate}
                    onChange={(value) =>
                      update(item.id, { allowPermanentCreate: value })
                    }
                  />
                  <ToggleCell
                    label="允许新建临时邮箱"
                    value={item.allowTempCreate}
                    onChange={(value) =>
                      update(item.id, { allowTempCreate: value })
                    }
                  />
                  <ToggleCell
                    label="接收邮件"
                    value={item.receivingEnabled}
                    onChange={(value) =>
                      update(item.id, { receivingEnabled: value })
                    }
                  />
                  <ToggleCell
                    label="发送邮件"
                    value={item.sendingEnabled}
                    onChange={(value) =>
                      update(item.id, { sendingEnabled: value })
                    }
                  />
                  <ToggleCell
                    label="默认长期域"
                    value={item.isDefaultPermanent}
                    onChange={(value) =>
                      update(item.id, { isDefaultPermanent: value })
                    }
                  />
                  <ToggleCell
                    label="默认临时域"
                    value={item.isDefaultTemp}
                    onChange={(value) =>
                      update(item.id, { isDefaultTemp: value })
                    }
                  />
                </div>

                {records.length > 0 ? (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-caption-1-medium text-accent-700">
                      DNS 记录（{records.length} 条）
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full min-w-[520px] text-start text-caption-1-regular">
                        <thead className="text-text-tertiary">
                          <tr>
                            <th className="py-1.5 pe-3 text-start font-medium">
                              类型
                            </th>
                            <th className="py-1.5 pe-3 text-start font-medium">
                              主机
                            </th>
                            <th className="py-1.5 pe-3 text-start font-medium">
                              值
                            </th>
                            <th className="py-1.5 text-start font-medium">
                              优先级
                            </th>
                          </tr>
                        </thead>
                        <tbody className="text-text-secondary">
                          {records.map((record, index) => (
                            <tr
                              key={index}
                              className="border-t border-separator-border"
                            >
                              <td className="py-1.5 pe-3">{record.type}</td>
                              <td className="py-1.5 pe-3 font-mono">
                                {record.name}
                              </td>
                              <td className="max-w-[280px] truncate py-1.5 pe-3 font-mono">
                                {record.value}
                              </td>
                              <td className="py-1.5">
                                {record.priority ?? '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ) : null}
              </div>
            )
          })}
        </div>
      </PageSection>

      <AddDomainModal
        open={open}
        onOpenChange={setOpen}
        providers={providers.data ?? []}
        onCreated={() => void refresh()}
      />

      <AlertDialog
        isOpen={Boolean(deleting)}
        onOpenChange={(next) => {
          if (!next) setDeleting(null)
        }}
        title="删除域名"
        description={
          deleting
            ? `确定删除「${deleting.hostname}」吗？域名下仍有邮箱时会被拒绝。`
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

function ToggleCell({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (value: boolean) => void | Promise<void>
}) {
  // Turso 往返期间锁住开关，避免用户重复点击后状态来回跳
  const [pending, setPending] = useState(false)
  return (
    <label className="flex items-center justify-between gap-2 rounded-xl bg-background-secondary-default px-3 py-2">
      <span className="text-caption-1-regular text-text-secondary">
        {label}
      </span>
      <Switch
        isSelected={value}
        isDisabled={pending}
        onChange={async (next) => {
          setPending(true)
          try {
            await onChange(next)
          } catch {
            // 失败提示已经由调用方 toast 出来
          } finally {
            setPending(false)
          }
        }}
      />
    </label>
  )
}

function AddDomainModal({
  open,
  onOpenChange,
  providers,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  providers: { id: string; label: string }[]
  onCreated: () => void
}) {
  const [hostname, setHostname] = useState('')
  const [providerId, setProviderId] = useState<string | null>(null)
  const [allowPermanentCreate, setAllowPermanentCreate] = useState(true)
  const [allowTempCreate, setAllowTempCreate] = useState(true)
  const [loading, setLoading] = useState(false)

  async function submit() {
    if (!hostname.trim()) {
      toast.error('请填写域名')
      return
    }
    if (!providerId) {
      toast.error('请选择服务商')
      return
    }
    if (!allowPermanentCreate && !allowTempCreate) {
      toast.error('至少要开启一种邮箱的新建权限')
      return
    }
    setLoading(true)
    const result = await adminCreateDomainFn({
      data: {
        hostname: hostname.trim().toLowerCase(),
        providerConfigId: providerId,
        allowPermanentCreate,
        allowTempCreate,
      },
    })
    setLoading(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('域名已创建，请按提示配置 DNS 后点击验证')
    setHostname('')
    onCreated()
    onOpenChange(false)
  }

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      {(renderProps) => (
        <>
          <ModalHeader
            title="添加域名"
            description="建议使用子域（如 mail.example.com），避免影响根域已有的企业邮箱"
          />
          <ModalBody className="flex flex-col gap-4">
            <Input
              label="域名"
              placeholder="mail.example.com"
              value={hostname}
              onChange={setHostname}
              inputDir="ltr"
            />
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
            <div className="flex flex-col gap-2">
              <ToggleCell
                label="允许新建长期邮箱"
                value={allowPermanentCreate}
                onChange={setAllowPermanentCreate}
              />
              <ToggleCell
                label="允许新建临时邮箱"
                value={allowTempCreate}
                onChange={setAllowTempCreate}
              />
            </div>
            <p className="text-caption-1-regular text-text-tertiary">
              这两个开关只控制「新建」，不影响域名下已有邮箱的收发；创建后会自动调用服务商
              API 生成 DNS 记录，到 DNS 服务商添加记录后回来点「验证」。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={renderProps.close}>
              取消
            </Button>
            <Button
              leadingIcon={RiCheckLine}
              onClick={submit}
              disabled={loading}
            >
              {loading ? '创建中…' : '创建'}
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  )
}
