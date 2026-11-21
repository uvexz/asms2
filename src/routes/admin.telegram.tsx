import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RiFileCopyLine,
  RiRefreshLine,
  RiSaveLine,
  RiSendPlaneLine,
  RiTelegram2Line,
} from '@remixicon/react'

import { Button } from '#/components/base/buttons/button'
import { Chip } from '#/components/base/badges/chip'
import { Input } from '#/components/base/input/input'
import { Switch } from '#/components/base/switch/switch'
import { Spinner } from '#/components/base/spinner/spinner'
import { toast } from '#/components/base/toast/toast'
import { ErrorState } from '#/components/application/errors/error-state'
import { KeyValue, PageSection } from '#/components/admin/ui'
import { formatDateTime, unwrap } from '#/lib/api'
import { queryKeys } from '#/lib/query-keys'
import {
  adminDeleteTelegramWebhookFn,
  adminGetTelegramFn,
  adminRegisterTelegramWebhookFn,
  adminSaveTelegramFn,
  adminTestTelegramFn,
} from '#/server/fns/telegram'

export const Route = createFileRoute('/admin/telegram')({
  head: () => ({ meta: [{ title: 'Telegram · 管理后台' }] }),
  component: AdminTelegram,
})

function AdminTelegram() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.admin.telegram,
    queryFn: async () => unwrap(await adminGetTelegramFn()),
  })

  const [enabled, setEnabled] = useState(false)
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (query.data) setEnabled(query.data.enabled)
  }, [query.data])

  const data = query.data

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('已复制')
    } catch {
      toast.error('复制失败，请手动选择')
    }
  }

  async function save(options: { regenerateSecret?: boolean } = {}) {
    setSaving(true)
    const result = await adminSaveTelegramFn({
      data: {
        enabled,
        ...(token.trim() ? { botToken: token.trim() } : {}),
        ...(options.regenerateSecret ? { regenerateSecret: true } : {}),
      },
    })
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setToken('')
    queryClient.setQueryData(queryKeys.admin.telegram, result.data)
    toast.success('已保存')
  }

  async function registerWebhook() {
    setBusy('register')
    const result = await adminRegisterTelegramWebhookFn()
    setBusy(null)
    if (!result.ok) {
      toast.error(result.error.message)
      await query.refetch()
      return
    }
    toast.success('Webhook 已注册')
    await query.refetch()
  }

  async function removeWebhook() {
    setBusy('remove')
    const result = await adminDeleteTelegramWebhookFn()
    setBusy(null)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Webhook 已取消')
    await query.refetch()
  }

  async function sendTest() {
    setBusy('test')
    const result = await adminTestTelegramFn()
    setBusy(null)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(`已发送 ${result.data.sent} 条测试消息`)
  }

  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        title="Telegram 配置加载失败"
        onRetry={() => void query.refetch()}
      />
    )
  }

  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-6" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageSection
        title="Telegram 机器人"
        description="Bot Token 与 Webhook Secret 加密存储，界面只显示末四位；保存不会自动注册 Webhook"
        actions={
          <Button
            leadingIcon={RiSaveLine}
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? '保存中…' : '保存配置'}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Switch isSelected={enabled} onChange={setEnabled}>
              启用 Telegram 机器人
            </Switch>
            <Chip color={data.enabled ? 'lime' : 'gray'}>
              {data.enabled ? '已启用' : '未启用'}
            </Chip>
            {data.botUsername ? (
              <span className="text-caption-1-regular text-text-tertiary">
                机器人：<span dir="ltr">@{data.botUsername}</span>
                {data.botId ? `（id ${data.botId}）` : ''}
              </span>
            ) : null}
          </div>

          <Input
            label="Bot Token"
            type="password"
            placeholder="123456789:AA..."
            value={token}
            onChange={setToken}
            inputDir="ltr"
            hint={
              data.hasToken
                ? `已保存 Token（末四位 ${data.tokenLast4 ?? '****'}）；留空表示不修改`
                : '在 @BotFather 用 /newbot 创建后获取'
            }
          />

          {data.lastError ? (
            <div className="rounded-xl border border-border-error-default bg-status-rose-background px-3 py-2">
              <p className="text-caption-1-regular text-status-rose-text">
                最近错误
                {data.lastErrorAt
                  ? `（${formatDateTime(data.lastErrorAt)}）`
                  : ''}
                ：{data.lastError}
              </p>
            </div>
          ) : null}
        </div>
      </PageSection>

      <PageSection
        title="Webhook"
        description="Telegram 只往固定路径推送，Secret 走请求头校验；换域名或重置 Secret 后必须重新注册"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="small"
              variant="secondary"
              leadingIcon={RiRefreshLine}
              onClick={() => void registerWebhook()}
              disabled={busy !== null}
            >
              {busy === 'register' ? '注册中…' : '注册 / 更新'}
            </Button>
            <Button
              size="small"
              variant="secondary"
              leadingIcon={RiSendPlaneLine}
              onClick={() => void sendTest()}
              disabled={busy !== null}
            >
              {busy === 'test' ? '发送中…' : '发送测试消息'}
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => void removeWebhook()}
              disabled={busy !== null || !data.webhookUrl}
            >
              取消注册
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-1">
          <KeyValue
            label="期望地址"
            value={
              data.expectedUrl ? (
                <span className="font-mono text-caption-1-medium" dir="ltr">
                  {data.expectedUrl}
                </span>
              ) : (
                '未配置站点地址'
              )
            }
          />
          <KeyValue
            label="已注册"
            value={
              data.webhookUrl ? (
                <span className="font-mono text-caption-1-medium" dir="ltr">
                  {data.webhookUrl}
                </span>
              ) : (
                '未注册'
              )
            }
          />
          <KeyValue
            label="注册时间"
            value={data.webhookSetAt ? formatDateTime(data.webhookSetAt) : '—'}
          />
          <KeyValue
            label="Secret 末四位"
            value={data.webhookSecretLast4 ?? '未生成'}
          />
        </div>

        {!data.expectedUrl ? (
          <p className="mt-3 text-caption-1-regular text-status-orange-text">
            请先到「站点信息」填写站点地址（siteUrl），否则无法拼出 Webhook
            URL。
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="small"
            variant="ghost"
            onClick={() => void save({ regenerateSecret: true })}
            disabled={saving}
          >
            重置 Webhook Secret
          </Button>
          <span className="text-caption-1-regular text-text-tertiary">
            重置后旧地址立即失效，需要重新注册
          </span>
        </div>
      </PageSection>

      <PageSection
        title="接入步骤"
        description="完整流程走一遍即可上线，详细排障见 docs/telegram.md"
      >
        <ol className="flex list-decimal flex-col gap-2 ps-5 text-caption-1-regular text-text-secondary">
          <li>
            在 Telegram 找 <span className="font-mono">@BotFather</span>，发送{' '}
            <span className="font-mono">/newbot</span> 获取 Bot Token。
          </li>
          <li>把 Token 填到上面并保存，打开「启用」开关。</li>
          <li>
            确认「站点信息」里的 siteUrl 是公网 HTTPS 地址（Telegram 不接受
            http）。
          </li>
          <li>点「注册 / 更新」，看到已注册地址即成功。</li>
          <li>
            用户到「个人设置 → Telegram 通知」生成绑定码，在机器人里发送{' '}
            <span className="font-mono">/bind 绑定码</span> 完成绑定。
          </li>
          <li>用「发送测试消息」验证管理员自己已绑定的会话能收到。</li>
        </ol>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="small"
            variant="secondary"
            leadingIcon={RiFileCopyLine}
            onClick={() => void copy(data.webhookPath)}
          >
            复制 Webhook 路径
          </Button>
          <span
            className="min-w-0 break-all font-mono text-caption-1-regular text-text-tertiary"
            dir="ltr"
          >
            {data.webhookPath}
          </span>
          <RiTelegram2Line
            className="size-4 text-foreground-icon-tertiary"
            aria-hidden
          />
        </div>
      </PageSection>
    </div>
  )
}
