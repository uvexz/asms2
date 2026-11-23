import { useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RiArrowLeftLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiFingerprintLine,
  RiGithubLine,
  RiGoogleLine,
  RiKey2Line,
  RiLinkM,
  RiMailLine,
  RiRefreshLine,
  RiSaveLine,
  RiTelegram2Line,
} from '@remixicon/react'

import { Button } from '#/components/base/buttons/button'
import { Chip } from '#/components/base/badges/chip'
import { Divider } from '#/components/base/divider/divider'
import { Input } from '#/components/base/input/input'
import { AlertDialog } from '#/components/base/modal/modal'
import { Select, SelectItem } from '#/components/base/select/select'
import { Spinner } from '#/components/base/spinner/spinner'
import { Switch } from '#/components/base/switch/switch'
import { toast } from '#/components/base/toast/toast'
import { ErrorState } from '#/components/application/errors/error-state'
import { ThemeToggle } from '#/components/application/theme/theme-toggle'
import { PageSection, KeyValue } from '#/components/admin/ui'
import { authClient } from '#/lib/auth-client'
import { usePowHeaders } from '#/lib/pow-client'
import { loginConfigQuery, mailboxesQuery, quotaQuery, unwrap } from '#/lib/api'
import { queryKeys } from '#/lib/query-keys'
import { listSsoAccountsFn, unlinkSsoAccountFn } from '#/server/fns/account'
import {
  createTelegramBindCodeFn,
  telegramStatusFn,
  unbindTelegramFn,
  updateTelegramNotifyFn,
} from '#/server/fns/telegram'

export const Route = createFileRoute('/settings')({
  // OAuth 绑定回调会带 linked / error，用完即清
  validateSearch: (search: Record<string, unknown>) => {
    const result: { linked?: string; error?: string } = {}
    if (typeof search.linked === 'string') result.linked = search.linked
    if (typeof search.error === 'string') result.error = search.error
    return result
  },
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
  create: (input: { name: string }) => Promise<{
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
    queryKey: queryKeys.apiKeys,
    queryFn: async () => {
      const result = await apiKeyClient().list()
      if (result.error) {
        throw new Error(result.error.message ?? '读取 API Key 失败')
      }
      return result.data?.apiKeys ?? []
    },
  })

  async function saveProfile() {
    if (saving) return
    setSaving(true)
    try {
      const { error } = await authClient.updateUser({ name })
      if (error) {
        toast.error(error.message ?? '保存失败')
        return
      }
      toast.success('资料已更新')
    } catch {
      toast.error('保存失败，请检查网络后重试')
    } finally {
      setSaving(false)
    }
  }

  async function createKey() {
    if (keyLoading) return
    setKeyLoading(true)
    try {
      const label = keyName.trim() || 'default'
      // 限流参数是 server-only 字段，由服务端插件统一配置（120 次/分钟）
      const result = await apiKeyClient().create({ name: label })
      if (result.error || !result.data?.key) {
        toast.error(result.error?.message ?? '创建失败')
        return
      }
      setNewKey(result.data.key)
      setKeyName('')
      // 立即把新 Key 追加到列表，而不是等下一次整页刷新
      queryClient.setQueryData<ApiKeyRow[]>(queryKeys.apiKeys, (old) => [
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
    } catch {
      toast.error('创建失败，请检查网络后重试')
    } finally {
      setKeyLoading(false)
    }
  }

  async function revokeKey() {
    if (!revoking) return
    let result: Awaited<ReturnType<ReturnType<typeof apiKeyClient>['delete']>>
    try {
      result = await apiKeyClient().delete({ keyId: revoking.id })
    } catch {
      toast.error('删除失败，请检查网络后重试')
      throw new Error('API key deletion request failed')
    }
    if (result.error) {
      toast.error(result.error.message ?? '删除失败')
      throw new Error(result.error.message ?? '删除失败')
    }
    queryClient.setQueryData<ApiKeyRow[]>(queryKeys.apiKeys, (old) =>
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

      <SsoSection />

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
            autoCorrect="off"
            spellCheck="false"
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
    queryKey: queryKeys.telegramStatus,
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
    if (generating) return
    setGenerating(true)
    try {
      const result = await createTelegramBindCodeFn()
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      setCode(result.data)
    } catch {
      toast.error('生成绑定码失败，请检查网络后重试')
    } finally {
      setGenerating(false)
    }
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
  // 重发验证邮件很少用到，点按钮时再现算，不在打开设置页时占 CPU
  const pow = usePowHeaders(false)
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
    try {
      const result = await authClient.passkey.listUserPasskeys()
      if (result.error) return
      setPasskeys(result.data)
    } catch {
      toast.error('读取 Passkey 失败，请检查网络后重试')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (passkeyEnabled) void loadPasskeys()
  }, [passkeyEnabled])

  async function addPasskey() {
    if (adding) return
    setAdding(true)
    try {
      const result = await authClient.passkey.addPasskey({
        name: name.trim() || undefined,
      })
      if (result.error) {
        toast.error(result.error.message ?? '绑定 Passkey 失败')
        return
      }
      toast.success('Passkey 已绑定')
      setName('')
      await loadPasskeys()
    } catch {
      toast.error('绑定 Passkey 失败，请检查网络或浏览器权限后重试')
    } finally {
      setAdding(false)
    }
  }

  async function removePasskey(row: PasskeyRow) {
    let result: Awaited<ReturnType<typeof authClient.passkey.deletePasskey>>
    try {
      result = await authClient.passkey.deletePasskey({ id: row.id })
    } catch {
      toast.error('删除 Passkey 失败，请检查网络后重试')
      throw new Error('Passkey deletion request failed')
    }
    if (result.error) {
      toast.error(result.error.message ?? '删除失败')
      throw new Error(result.error.message ?? '删除失败')
    }
    setPasskeys((prev) => prev.filter((item) => item.id !== row.id))
    setDeleting(null)
    toast.success('Passkey 已删除')
  }

  async function resendVerification() {
    if (sending) return
    setSending(true)
    try {
      const { error } = await authClient.sendVerificationEmail({
        email: session?.email ?? '',
        callbackURL: '/verify-email?verified=1',
        fetchOptions: { headers: await pow.getHeaders() },
      })
      if (error) {
        toast.error(error.message ?? '发送失败，请稍后再试')
        return
      }
      toast.success('验证邮件已发送')
    } catch {
      toast.error('发送失败，请检查网络后重试')
    } finally {
      setSending(false)
    }
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
              autoCorrect="off"
              spellCheck="false"
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

/* ------------------------------------------------------------- third-party sso */

type SsoKind = 'email' | 'google' | 'github' | 'oidc'

interface SsoAccount {
  id: string
  providerId: string
  label: string
  kind: SsoKind
  linkedAt: number
  enabled: boolean
  removable: boolean
}

const SSO_ICONS: Record<SsoKind, ComponentType<{ className?: string }>> = {
  email: RiMailLine,
  google: RiGoogleLine,
  github: RiGithubLine,
  oidc: RiLinkM,
}

/** OAuth 回调失败时 better-auth 会带 `?error=<code>` 回到本页 */
const SSO_ERROR_MESSAGES: Record<string, string> = {
  email_does_not_match: '该平台账号的邮箱与本站不一致，无法绑定',
  account_already_linked_to_different_user: '该平台账号已绑定到其他用户',
  unable_to_link_account: '绑定失败，请确认该平台账号可用后重试',
  oauth_provider_not_found: '该登录方式已被管理员停用',
  state_not_found: '绑定请求已过期，请重新发起',
  access_denied: '已取消授权',
}

function SsoSection() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const search = Route.useSearch()

  const query = useQuery({
    queryKey: queryKeys.ssoAccounts,
    queryFn: async () => unwrap(await listSsoAccountsFn()),
    staleTime: 20_000,
  })

  const [busy, setBusy] = useState<string | null>(null)
  const [unlinking, setUnlinking] = useState<SsoAccount | null>(null)
  // 同一次回调只提示一遍（清查询串前可能有多次渲染）
  const handled = useRef<string | null>(null)

  useEffect(() => {
    const key = search.error
      ? `error:${search.error}`
      : search.linked
        ? `linked:${search.linked}`
        : null
    if (!key || handled.current === key) return
    handled.current = key
    if (search.error) {
      toast.error(
        SSO_ERROR_MESSAGES[search.error] ?? `绑定失败（${search.error}）`,
      )
    } else {
      toast.success('已绑定第三方账号')
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.ssoAccounts })
    // 清掉查询串，避免刷新页面时重复提示
    void navigate({
      to: '/settings',
      search: { linked: undefined, error: undefined },
      replace: true,
    })
  }, [search.linked, search.error, navigate, queryClient])

  async function bind(providerId: string) {
    if (busy) return
    setBusy(providerId)
    try {
      const { error } = await authClient.linkSocial({
        provider: providerId,
        callbackURL: `/settings?linked=${encodeURIComponent(providerId)}`,
        errorCallbackURL: '/settings',
      })
      // 成功时浏览器已经跳去目标平台，这里只处理没能发起授权的情况
      if (error) toast.error(error.message ?? '发起绑定失败，请稍后重试')
    } catch {
      toast.error('发起绑定失败，请检查网络后重试')
    } finally {
      setBusy(null)
    }
  }

  async function unlink(row: SsoAccount) {
    const result = await unlinkSsoAccountFn({ data: { accountId: row.id } })
    if (!result.ok) {
      toast.error(result.error.message)
      throw new Error(result.error.message)
    }
    toast.success('已解绑')
    setUnlinking(null)
    await query.refetch()
  }

  const accounts = query.data?.accounts ?? []
  const bindable = query.data?.bindable ?? []

  return (
    <PageSection
      title="第三方账号"
      description="绑定后可用对应平台直接登录；解绑前请确认还有其他可用的登录方式"
      actions={
        <Button
          size="small"
          variant="secondary"
          leadingIcon={RiRefreshLine}
          onClick={() => void query.refetch()}
        >
          刷新状态
        </Button>
      }
    >
      {query.isLoading ? (
        <div className="flex items-center gap-2 text-caption-1-regular text-text-tertiary">
          <Spinner className="size-4" /> 加载中…
        </div>
      ) : null}

      {query.isError ? (
        <ErrorState
          compact
          title="读取登录方式失败"
          error={query.error}
          onRetry={() => void query.refetch()}
          className="py-4"
        />
      ) : null}

      {query.data ? (
        <div className="flex flex-col gap-2">
          {accounts.length === 0 ? (
            <p className="text-caption-1-regular text-text-tertiary">
              还没有绑定任何登录账号。
            </p>
          ) : null}

          {accounts.map((row) => {
            const Icon = SSO_ICONS[row.kind]
            return (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-button-default px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Icon
                    className="size-4 shrink-0 text-foreground-icon-primary"
                    aria-hidden
                  />
                  <span className="truncate text-body-medium text-text-primary">
                    {row.label}
                  </span>
                  {row.kind === 'email' ? <Chip color="gray">本站</Chip> : null}
                  {!row.enabled ? <Chip color="yellow">已停用</Chip> : null}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-caption-1-regular text-text-tertiary">
                    绑定于 {new Date(row.linkedAt).toLocaleDateString('zh-CN')}
                  </span>
                  {row.kind === 'email' ? null : row.removable ? (
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={() => setUnlinking(row)}
                    >
                      解绑
                    </Button>
                  ) : (
                    <span className="text-caption-1-regular text-text-tertiary">
                      需保留至少一种登录方式
                    </span>
                  )}
                </div>
              </div>
            )
          })}

          {bindable.length > 0 ? (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-caption-1-semibold text-text-secondary">
                可绑定
              </p>{' '}
              {bindable.map((option) => {
                const Icon = SSO_ICONS[option.kind]
                return (
                  <div
                    key={option.providerId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border-button-default px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon
                        className="size-4 shrink-0 text-foreground-icon-tertiary"
                        aria-hidden
                      />
                      <span className="truncate text-body-medium text-text-secondary">
                        {option.label}
                      </span>
                      {option.kind === 'oidc' ? (
                        <code
                          className="font-mono text-caption-1-regular text-text-tertiary"
                          dir="ltr"
                        >
                          {option.providerId}
                        </code>
                      ) : null}
                    </div>
                    <Button
                      size="small"
                      variant="secondary"
                      leadingIcon={RiLinkM}
                      onClick={() => void bind(option.providerId)}
                      disabled={busy === option.providerId}
                    >
                      {busy === option.providerId ? '跳转中…' : '绑定'}
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : null}

          {bindable.length === 0 &&
          !accounts.some((row) => row.kind !== 'email') ? (
            <p className="text-caption-1-regular text-text-tertiary">
              管理员尚未配置可绑定的第三方登录方式。
            </p>
          ) : null}

          {accounts.some((row) => row.kind !== 'email') ? (
            <p className="mt-1 text-caption-1-regular text-text-tertiary">
              解绑仅影响本站登录方式，不会注销你在该平台的账号。
            </p>
          ) : null}
        </div>
      ) : null}

      <AlertDialog
        isOpen={Boolean(unlinking)}
        onOpenChange={(open) => {
          if (!open) setUnlinking(null)
        }}
        title="解绑登录账号"
        description={
          unlinking
            ? `解绑后将无法再用「${unlinking.label}」登录本站，确定继续吗？`
            : ''
        }
        confirmLabel="解绑"
        cancelLabel="取消"
        pendingLabel="解绑中…"
        onConfirm={async () => {
          if (unlinking) await unlink(unlinking)
        }}
      />
    </PageSection>
  )
}
