import { useEffect, useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RiArrowLeftLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiFingerprintLine,
  RiKey2Line,
  RiRefreshLine,
  RiSaveLine,
  RiTelegram2Line,
} from '@remixicon/react'

import { Button } from '@/components/base/buttons/button'
import { Chip } from '@/components/base/badges/chip'
import { Divider } from '@/components/base/divider/divider'
import { Input } from '@/components/base/input/input'
import { AlertDialog } from '@/components/base/modal/modal'
import { Select, SelectItem } from '@/components/base/select/select'
import { Spinner } from '@/components/base/spinner/spinner'
import { Switch } from '@/components/base/switch/switch'
import { toast } from '@/components/base/toast/toast'
import { ErrorState } from '@/components/application/errors/error-state'
import { ThemeToggle } from '@/components/application/theme/theme-toggle'
import { PageSection, KeyValue } from '@/components/admin/ui'
import { authClient } from '#/lib/auth-client'
import { loginConfigQuery, mailboxesQuery, quotaQuery, unwrap } from '#/lib/api'
import {
  createTelegramBindCodeFn,
  telegramStatusFn,
  unbindTelegramFn,
  updateTelegramNotifyFn,
} from '#/server/fns/telegram'

export const Route = createFileRoute('/settings')({
  beforeLoad: ({ context }) => {
    if (!context.session) {
      throw redirect({ to: '/login' })
    }
    if (
      context.session.emailVerificationRequired &&
      !context.session.emailVerified
    ) {
      throw redirect({ to: '/verify-email' })
    }
  },
  head: () => ({ meta: [{ title: '个人设置' }] }),
  component: SettingsPage,
})

interface ApiKeyRow {
  id: string
  name?: string | null
  start?: string | null
  createdAt?: string | Date
  lastRequest?: string | Date | null
  enabled?: boolean | null
}

interface ApiKeyClient {
  list: () => Promise<{
    data?: { apiKeys?: ApiKeyRow[] }
    error?: { message?: string }
  }>
  create: (input: {
    name: string
    rateLimitEnabled?: boolean
    rateLimitMax?: number
    rateLimitTimeWindow?: number
  }) => Promise<{
    data?: { key?: string; id?: string }
    error?: { message?: string }
  }>
  delete: (input: {
    keyId: string
  }) => Promise<{ error?: { message?: string } }>
}

function apiKeyClient() {
  return (authClient as unknown as { apiKey: ApiKeyClient }).apiKey
}

function SettingsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session } = Route.useRouteContext()

  const mailboxes = useQuery(mailboxesQuery)
  const quota = useQuery(quotaQuery)

  const [name, setName] = useState(session?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [keyLoading, setKeyLoading] = useState(false)
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null)

  useEffect(() => {
    setName(session?.name ?? '')
  }, [session?.name])

  const keysQuery = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const result = await apiKeyClient().list()
      if (result.error) {
        throw new Error(result.error.message ?? '读取 API Key 失败')
      }
      return result.data?.apiKeys ?? []
    },
  })

  async function saveProfile() {
    setSaving(true)
    const { error } = await authClient.updateUser({ name })
    setSaving(false)
    if (error) {
      toast.error(error.message ?? '保存失败')
      return
    }
    toast.success('资料已更新')
  }

  async function createKey() {
    setKeyLoading(true)
    const label = keyName.trim() || 'default'
    const result = await apiKeyClient().create({
      name: label,
      rateLimitEnabled: true,
      rateLimitMax: 120,
      rateLimitTimeWindow: 60_000,
    })
    setKeyLoading(false)
    if (result.error || !result.data?.key) {
      toast.error(result.error?.message ?? '创建失败')
      return
    }
    setNewKey(result.data.key)
    setKeyName('')
    // 立即把新 Key 追加到列表，而不是等下一次整页刷新
    queryClient.setQueryData<ApiKeyRow[]>(['api-keys'], (old) => [
      {
        id: result.data?.id ?? result.data!.key!,
        name: label,
        start: result.data!.key!.slice(0, 6),
        createdAt: new Date(),
        enabled: true,
      },
      ...(old ?? []),
    ])
    toast.success('API Key 已创建，请立即保存')
  }

  async function revokeKey() {
    if (!revoking) return
    const result = await apiKeyClient().delete({ keyId: revoking.id })
    if (result.error) {
      toast.error(result.error.message ?? '删除失败')
      throw new Error(result.error.message ?? '删除失败')
    }
    queryClient.setQueryData<ApiKeyRow[]>(['api-keys'], (old) =>
      (old ?? []).filter((item) => item.id !== revoking.id),
    )
    setRevoking(null)
    toast.success('已吊销')
  }

  const permanent = (mailboxes.data ?? []).filter(
    (item) => item.kind === 'permanent' && item.status !== 'deleted',
  )

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-5 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-title-2-medium text-text-primary">个人设置</h1>
          <p className="mt-1 text-body-regular text-text-secondary">
            {session?.email}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle appearance="segmented" size="small" />
          <Button
            variant="secondary"
            leadingIcon={RiArrowLeftLine}
            onClick={() =>
              void navigate({ to: '/mail', search: { folder: 'inbox' } })
            }
          >
            返回邮箱
          </Button>
        </div>
      </div>

      <PageSection title="资料">
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="昵称"
            value={name}
            onChange={setName}
            className="max-w-xs"
          />
          <Button
            leadingIcon={RiSaveLine}
            onClick={saveProfile}
            disabled={saving}
          >
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </PageSection>

      <PageSection title="配额">
        {mailboxes.isError || quota.isError ? (
          <ErrorState
            compact
            error={mailboxes.error ?? quota.error}
            onRetry={() => {
              void mailboxes.refetch()
              void quota.refetch()
            }}
            className="py-4"
          />
        ) : (
          <div className="flex flex-col gap-1">
            <KeyValue
              label="长期邮箱"
              value={`${permanent.length}${session?.mailboxLimit ? ` / ${session.mailboxLimit}` : ''}`}
            />
            <KeyValue
              label="今日发件"
              value={
                quota.data
                  ? `${quota.data.sent} / ${quota.data.limit}（剩余 ${quota.data.remaining}）`
                  : '—'
              }
            />
            <KeyValue
              label="角色"
              value={session?.role === 'admin' ? '管理员' : '普通用户'}
            />
          </div>
        )}
      </PageSection>

      <SecuritySection />

      <TelegramSection />

      <PageSection
        title="API Key"
        description="用于 /api/v1 接口；创建后只显示一次，请立即保存"
      >
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="名称"
            placeholder="ci-script"
            value={keyName}
            onChange={setKeyName}
            className="max-w-xs"
            inputDir="ltr"
          />
          <Button
            leadingIcon={RiKey2Line}
            onClick={createKey}
            disabled={keyLoading}
          >
            {keyLoading ? '创建中…' : '创建 Key'}
          </Button>
        </div>

        {newKey ? (
          <div className="mt-3 rounded-xl border border-accent-200 bg-accent-50 p-3">
            <p className="text-caption-1-regular text-accent-800">
              仅显示一次，请复制保存：
            </p>
            <code className="mt-1 block break-all font-mono text-caption-1-medium text-accent-900">
              {newKey}
            </code>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-2">
          {keysQuery.isLoading ? (
            <div className="flex items-center gap-2 text-caption-1-regular text-text-tertiary">
              <Spinner className="size-4" /> 加载 API Key…
            </div>
          ) : null}
          {keysQuery.isError ? (
            <ErrorState
              compact
              title="读取 API Key 失败"
              error={keysQuery.error}
              onRetry={() => void keysQuery.refetch()}
              className="py-4"
            />
          ) : null}
          {!keysQuery.isLoading &&
          !keysQuery.isError &&
          (keysQuery.data ?? []).length === 0 ? (
            <p className="text-caption-1-regular text-text-tertiary">
              还没有 API Key
            </p>
          ) : null}
          {(keysQuery.data ?? []).map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border-button-default px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-body-regular text-text-primary">
                  {key.name || '未命名'}
                </span>
                <Chip color="gray">{key.start ?? '...'}</Chip>
              </div>
              <Button
                size="small"
                variant="ghost"
                aria-label={`吊销 ${key.name || 'API Key'}`}
                onClick={() => setRevoking(key)}
              >
                <RiDeleteBinLine className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      </PageSection>

      <AlertDialog
        isOpen={Boolean(revoking)}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
        title="吊销 API Key"
        description={
          revoking
            ? `确定吊销「${revoking.name || '未命名'}」吗？使用该 Key 的脚本会立即失效。`
            : ''
        }
        confirmLabel="吊销"
        cancelLabel="取消"
        pendingLabel="吊销中…"
        onConfirm={revokeKey}
      />
    </div>
  )
}

/* ------------------------------------------------------------ telegram ui */

type TelegramScope = 'all' | 'temp' | 'permanent'

interface TelegramLinkView {
  id: string
  chatLabel: string
  notifyEnabled: boolean
  notifyScope: TelegramScope
  linkedAt: number
  lastNotifiedAt: number | null
}

function TelegramSection() {
  const status = useQuery({
    queryKey: ['telegram', 'status'],
    queryFn: async () => unwrap(await telegramStatusFn()),
    staleTime: 10_000,
  })
  const [code, setCode] = useState<{
    code: string
    expiresAt: number
    deepLink: string | null
  } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [unbinding, setUnbinding] = useState<TelegramLinkView | null>(null)

  const data = status.data

  async function generateCode() {
    setGenerating(true)
    const result = await createTelegramBindCodeFn()
    setGenerating(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setCode(result.data)
  }

  async function toggleNotify(link: TelegramLinkView, enabled: boolean) {
    const result = await updateTelegramNotifyFn({
      data: { linkId: link.id, notifyEnabled: enabled },
    })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    await status.refetch()
  }

  async function changeScope(link: TelegramLinkView, scope: TelegramScope) {
    const result = await updateTelegramNotifyFn({
      data: { linkId: link.id, notifyScope: scope },
    })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    await status.refetch()
  }

  async function unbind(link: TelegramLinkView) {
    const result = await unbindTelegramFn({ data: { linkId: link.id } })
    if (!result.ok) {
      toast.error(result.error.message)
      throw new Error(result.error.message)
    }
    toast.success('已解绑')
    setUnbinding(null)
    await status.refetch()
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('已复制')
    } catch {
      toast.error('复制失败，请手动选择')
    }
  }

  return (
    <PageSection
      title="Telegram 通知"
      description="绑定后新邮件实时推送；也可以在 Telegram 里创建临时邮箱、查看正文"
      actions={
        <Button
          size="small"
          variant="secondary"
          leadingIcon={RiRefreshLine}
          onClick={() => void status.refetch()}
        >
          刷新状态
        </Button>
      }
    >
      {status.isLoading ? (
        <div className="flex items-center gap-2 text-caption-1-regular text-text-tertiary">
          <Spinner className="size-4" /> 加载中…
        </div>
      ) : null}

      {status.isError ? (
        <ErrorState
          compact
          title="读取 Telegram 状态失败"
          error={status.error}
          onRetry={() => void status.refetch()}
          className="py-4"
        />
      ) : null}

      {data && !data.enabled ? (
        <p className="rounded-xl border border-border-button-default bg-background-secondary-default px-3 py-2 text-caption-1-regular text-text-secondary">
          管理员尚未启用 Telegram 机器人，暂时无法绑定。
        </p>
      ) : null}

      {data?.enabled ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-caption-1-regular text-text-tertiary">
              {data.botUsername ? (
                <>
                  机器人：
                  <span className="font-mono text-text-secondary" dir="ltr">
                    @{data.botUsername}
                  </span>
                </>
              ) : (
                '机器人已启用'
              )}
              {' · '}最多绑定 {data.maxLinks} 个会话
            </p>
            <Button
              size="small"
              leadingIcon={RiTelegram2Line}
              onClick={() => void generateCode()}
              disabled={generating || data.links.length >= data.maxLinks}
            >
              {generating ? '生成中…' : '生成绑定码'}
            </Button>
          </div>

          {code ? (
            <div className="rounded-xl border border-accent-200 bg-accent-50 p-3">
              <p className="text-caption-1-regular text-accent-800">
                绑定码 10 分钟内有效。在 Telegram 里向机器人发送：
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <code className="font-mono text-title-3-semibold tracking-wider text-accent-900">
                  /bind {code.code}
                </code>
                <Button
                  size="small"
                  variant="secondary"
                  leadingIcon={RiFileCopyLine}
                  onClick={() => void copy(`/bind ${code.code}`)}
                >
                  复制命令
                </Button>
                {code.deepLink ? (
                  <a
                    href={code.deepLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-caption-1-medium text-accent-700 underline underline-offset-2"
                  >
                    在 Telegram 中打开
                  </a>
                ) : null}
                <span className="text-caption-1-regular text-accent-700">
                  绑定完成后点「刷新状态」
                </span>
              </div>
            </div>
          ) : null}

          {data.links.length === 0 ? (
            <p className="text-caption-1-regular text-text-tertiary">
              尚未绑定任何 Telegram 会话。
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {data.links.map((link) => (
                <div
                  key={link.id}
                  className="flex flex-col gap-3 rounded-xl border border-border-button-default px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-body-medium text-text-primary">
                      {link.chatLabel}
                    </span>
                    <Chip color={link.notifyEnabled ? 'lime' : 'gray'}>
                      {link.notifyEnabled ? '推送中' : '已暂停'}
                    </Chip>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Select
                      aria-label="推送范围"
                      size="sm"
                      selectedKey={link.notifyScope}
                      onSelectionChange={(key) =>
                        void changeScope(link, key as TelegramScope)
                      }
                      className="w-36"
                    >
                      <SelectItem id="all">全部邮件</SelectItem>
                      <SelectItem id="temp">仅临时邮箱</SelectItem>
                      <SelectItem id="permanent">仅长期邮箱</SelectItem>
                    </Select>
                    <Switch
                      size="sm"
                      isSelected={link.notifyEnabled}
                      onChange={(enabled) => void toggleNotify(link, enabled)}
                    >
                      通知
                    </Switch>
                    <Button
                      size="small"
                      variant="ghost"
                      aria-label={`解绑 ${link.chatLabel}`}
                      onClick={() => setUnbinding(link)}
                    >
                      <RiDeleteBinLine className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <AlertDialog
        isOpen={Boolean(unbinding)}
        onOpenChange={(open) => {
          if (!open) setUnbinding(null)
        }}
        title="解绑 Telegram 会话"
        description={
          unbinding ? `确定不再向「${unbinding.chatLabel}」推送新邮件吗？` : ''
        }
        confirmLabel="解绑"
        cancelLabel="取消"
        pendingLabel="解绑中…"
        onConfirm={async () => {
          if (unbinding) await unbind(unbinding)
        }}
      />
    </PageSection>
  )
}

/* ---------------------------------------------------------- login & security */

interface PasskeyRow {
  id: string
  name?: string | null
  createdAt?: string | Date | null
}

function SecuritySection() {
  const authQuery = useQuery(loginConfigQuery)
  const { session } = Route.useRouteContext()
  const passkeyEnabled = authQuery.data?.passkey.enabled ?? false
  const verificationRequired =
    authQuery.data?.emailPassword.verificationRequired ?? false

  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([])
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [sending, setSending] = useState(false)
  const [supported, setSupported] = useState(true)
  const [deleting, setDeleting] = useState<PasskeyRow | null>(null)

  useEffect(() => {
    setSupported(
      typeof window !== 'undefined' &&
        typeof window.PublicKeyCredential !== 'undefined' &&
        Boolean(window.isSecureContext),
    )
  }, [])

  async function loadPasskeys() {
    setLoading(true)
    const result = await authClient.passkey.listUserPasskeys()
    setLoading(false)
    if (result.error) return
    setPasskeys(result.data)
  }

  useEffect(() => {
    if (passkeyEnabled) void loadPasskeys()
  }, [passkeyEnabled])

  async function addPasskey() {
    setAdding(true)
    const result = await authClient.passkey.addPasskey({
      name: name.trim() || undefined,
    })
    setAdding(false)
    if (result.error) {
      toast.error(result.error.message ?? '绑定 Passkey 失败')
      return
    }
    toast.success('Passkey 已绑定')
    setName('')
    await loadPasskeys()
  }

  async function removePasskey(row: PasskeyRow) {
    const result = await authClient.passkey.deletePasskey({ id: row.id })
    if (result.error) {
      toast.error(result.error.message ?? '删除失败')
      throw new Error(result.error.message ?? '删除失败')
    }
    setPasskeys((prev) => prev.filter((item) => item.id !== row.id))
    setDeleting(null)
    toast.success('Passkey 已删除')
  }

  async function resendVerification() {
    setSending(true)
    const { error } = await authClient.sendVerificationEmail({
      email: session?.email ?? '',
      callbackURL: '/verify-email?verified=1',
    })
    setSending(false)
    if (error) {
      toast.error(error.message ?? '发送失败，请稍后再试')
      return
    }
    toast.success('验证邮件已发送')
  }

  return (
    <PageSection title="登录与安全" description="邮箱验证状态与 Passkey">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-body-regular text-text-primary">邮箱验证</span>
          <Chip color={session?.emailVerified ? 'lime' : 'yellow'}>
            {session?.emailVerified ? '已验证' : '未验证'}
          </Chip>
        </div>
        {verificationRequired && !session?.emailVerified ? (
          <Button
            size="small"
            variant="secondary"
            onClick={() => void resendVerification()}
            disabled={sending}
          >
            {sending ? '发送中…' : '发送验证邮件'}
          </Button>
        ) : null}
      </div>
      {!verificationRequired ? (
        <p className="mt-1 text-caption-1-regular text-text-tertiary">
          站点未开启邮箱验证。
        </p>
      ) : null}

      <div className="my-4">
        <Divider />
      </div>

      <div className="flex items-center gap-2">
        <RiFingerprintLine
          className="size-4 text-foreground-icon-primary"
          aria-hidden
        />
        <span className="text-body-regular text-text-primary">Passkey</span>
      </div>

      {!passkeyEnabled ? (
        <p className="mt-2 text-caption-1-regular text-text-tertiary">
          管理员尚未启用 Passkey 登录。
        </p>
      ) : !supported ? (
        <p className="mt-2 text-caption-1-regular text-text-tertiary">
          当前浏览器或环境不支持 Passkey（需要 HTTPS 或 localhost）。
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Input
              label="名称"
              placeholder="MacBook Touch ID"
              value={name}
              onChange={setName}
              className="max-w-xs"
            />
            <Button
              leadingIcon={RiFingerprintLine}
              onClick={() => void addPasskey()}
              disabled={adding}
            >
              {adding ? '等待验证…' : '添加 Passkey'}
            </Button>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {loading ? (
              <div className="flex items-center gap-2 text-caption-1-regular text-text-tertiary">
                <Spinner className="size-4" /> 加载中…
              </div>
            ) : null}
            {!loading && passkeys.length === 0 ? (
              <p className="text-caption-1-regular text-text-tertiary">
                还没有绑定 Passkey
              </p>
            ) : null}
            {passkeys.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border-button-default px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-body-medium text-text-primary">
                    {item.name || 'Passkey'}
                  </p>
                  {item.createdAt ? (
                    <p className="text-caption-1-regular text-text-tertiary">
                      绑定于{' '}
                      {new Date(item.createdAt).toLocaleDateString('zh-CN')}
                    </p>
                  ) : null}
                </div>
                <Button
                  size="small"
                  variant="ghost"
                  aria-label={`删除 Passkey ${item.name || ''}`.trim()}
                  onClick={() => setDeleting(item)}
                >
                  <RiDeleteBinLine className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        </>
      )}

      <AlertDialog
        isOpen={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="删除 Passkey"
        description={
          deleting
            ? `确定删除「${deleting.name || 'Passkey'}」吗？之后将无法用它登录。`
            : ''
        }
        confirmLabel="删除"
        cancelLabel="取消"
        pendingLabel="删除中…"
        onConfirm={async () => {
          if (deleting) await removePasskey(deleting)
        }}
      />
    </PageSection>
  )
}
