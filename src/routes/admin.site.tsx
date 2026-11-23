import { useEffect, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RiSaveLine } from '@remixicon/react'

import { Button } from '#/components/base/buttons/button'
import { Input } from '#/components/base/input/input'
import { Switch } from '#/components/base/switch/switch'
import { Spinner } from '#/components/base/spinner/spinner'
import { toast } from '#/components/base/toast/toast'
import { ErrorState } from '#/components/application/errors/error-state'
import { PageSection } from '#/components/admin/ui'
import { adminGetSettingsFn, adminUpdateSettingsFn } from '#/server/fns/admin'
import { unwrap } from '#/lib/api'
import { queryKeys } from '#/lib/query-keys'
import { isValidTimeZone } from '#/lib/timezone'
import type { SiteSettings } from '#/server/settings'

export const Route = createFileRoute('/admin/site')({
  head: () => ({ meta: [{ title: '站点信息 · 管理后台' }] }),
  component: AdminSite,
})

const NUMBER_FIELDS: {
  key: keyof SiteSettings
  label: string
  hint?: string
}[] = [
  {
    key: 'defaultMailboxLimit',
    label: '默认长期邮箱上限',
    hint: '每个用户可创建的长期邮箱数',
  },
  {
    key: 'defaultDailySendLimit',
    label: '默认每日发件上限',
    hint: '每天 0 点（站点时区）重置',
  },
  {
    key: 'newAccountSendCooldownHours',
    label: '新账号发信冷却（小时）',
    hint: '注册后这段时间内不能发信，管理员除外；0 表示不限制',
  },
  { key: 'permanentPrefixMin', label: '长期邮箱前缀最短长度' },
  { key: 'tempPrefixMin', label: '临时邮箱前缀最短长度' },
  { key: 'prefixMax', label: '前缀最长长度' },
  {
    key: 'tempTtlMinutes',
    label: '临时邮箱考察期（分钟）',
    hint: '考察期内收到邮件即永久保留，否则失效',
  },
  {
    key: 'tempGraceMinutes',
    label: '失效后保留（分钟）',
    hint: '仅对未激活即失效的临时邮箱生效',
  },
  { key: 'tempCooldownHours', label: '临时地址冷却（小时）' },
  { key: 'permanentCooldownDays', label: '长期地址冷却（天）' },
  { key: 'trashRetentionDays', label: '回收站保留（天）' },
  { key: 'orphanRetentionDays', label: '孤儿邮件保留（天）' },
  {
    key: 'deletedMailboxRetentionDays',
    label: '已删除邮箱保留（天）',
    hint: '超期后清空邮件并删除邮箱墓碑，实际清理还会等待地址冷却期结束',
  },
]

const BOOLEAN_FIELDS: {
  key: keyof SiteSettings
  label: string
  hint?: string
}[] = [
  {
    key: 'registrationEnabled',
    label: '开放注册',
    hint: '关闭后新账号无法创建',
  },
  {
    key: 'captchaEnabled',
    label: '人机校验',
    hint: '注册、密码登录、找回密码、重发验证邮件前，浏览器需完成约 1 秒的计算（工作量证明，不依赖第三方）',
  },
  { key: 'allowTempSend', label: '允许临时邮箱发信', hint: '默认只收不发' },
  { key: 'allowUserDomainChoice', label: '允许用户选择域名' },
]

function AdminSite() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.admin.site,
    queryFn: async () => unwrap(await adminGetSettingsFn()),
  })
  const [form, setForm] = useState<SiteSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (query.data) setForm(query.data)
  }, [query.data])

  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        title="站点配置加载失败"
        onRetry={() => void query.refetch()}
      />
    )
  }

  if (!form) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-6" />
      </div>
    )
  }

  function set<TKey extends keyof SiteSettings>(
    key: TKey,
    value: SiteSettings[TKey],
  ) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  async function save() {
    if (!form) return
    if (!isValidTimeZone(form.timezone)) {
      toast.error('时区不合法，请填写 IANA 时区（如 Asia/Shanghai）')
      return
    }
    setSaving(true)
    try {
      const result = await adminUpdateSettingsFn({
        data: {
          siteName: form.siteName,
          siteDescription: form.siteDescription,
          // 之前漏传，导致「站点地址」改了保存不生效
          siteUrl: form.siteUrl,
          logoUrl: form.logoUrl,
          faviconUrl: form.faviconUrl,
          contactEmail: form.contactEmail,
          icpRecord: form.icpRecord,
          footerText: form.footerText,
          registrationEnabled: form.registrationEnabled,
          captchaEnabled: form.captchaEnabled,
          defaultMailboxLimit: form.defaultMailboxLimit,
          defaultDailySendLimit: form.defaultDailySendLimit,
          newAccountSendCooldownHours: form.newAccountSendCooldownHours,
          permanentPrefixMin: form.permanentPrefixMin,
          tempPrefixMin: form.tempPrefixMin,
          prefixMax: form.prefixMax,
          tempTtlMinutes: form.tempTtlMinutes,
          tempGraceMinutes: form.tempGraceMinutes,
          tempCooldownHours: form.tempCooldownHours,
          permanentCooldownDays: form.permanentCooldownDays,
          allowTempSend: form.allowTempSend,
          allowUserDomainChoice: form.allowUserDomainChoice,
          trashRetentionDays: form.trashRetentionDays,
          orphanRetentionDays: form.orphanRetentionDays,
          deletedMailboxRetentionDays: form.deletedMailboxRetentionDays,
          timezone: form.timezone,
        },
      })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      toast.success('站点配置已保存')
      // 根 loader 的站点信息在 SPA 内是陈旧快照，保存后主动刷新，
      // 否则侧栏站名要等整页刷新才更新
      queryClient.setQueryData(queryKeys.admin.site, result.data)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.publicLoginConfig,
      })
      await router.invalidate()
    } catch (error) {
      // 校验失败由 server fn 的 validator 抛出，不会走 result 分支
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageSection
        title="站点信息"
        description="展示在登录页、页面标题与页脚"
        actions={
          <Button leadingIcon={RiSaveLine} onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label="站点名称"
            value={form.siteName}
            onChange={(value) => set('siteName', value)}
          />
          <Input
            label="站点描述"
            value={form.siteDescription}
            onChange={(value) => set('siteDescription', value)}
          />
          <Input
            label="站点地址"
            value={form.siteUrl ?? ''}
            onChange={(value) => set('siteUrl', value || null)}
            placeholder="https://mail.example.com"
            inputDir="ltr"
          />
          <Input
            label="联系邮箱"
            value={form.contactEmail ?? ''}
            onChange={(value) => set('contactEmail', value || null)}
            inputDir="ltr"
          />
          <Input
            label="Logo 地址"
            value={form.logoUrl ?? ''}
            onChange={(value) => set('logoUrl', value || null)}
            inputDir="ltr"
          />
          <Input
            label="Favicon 地址"
            value={form.faviconUrl ?? ''}
            onChange={(value) => set('faviconUrl', value || null)}
            inputDir="ltr"
          />
          <Input
            label="ICP 备案号"
            value={form.icpRecord ?? ''}
            onChange={(value) => set('icpRecord', value || null)}
          />
          <Input
            label="页脚文案"
            value={form.footerText ?? ''}
            onChange={(value) => set('footerText', value || null)}
          />
        </div>
      </PageSection>

      <PageSection
        title="配额与有效期"
        description="修改后对新创建生效，已存在的邮箱不追溯"
      >
        <div className="grid gap-4 md:grid-cols-3">
          {NUMBER_FIELDS.map((field) => (
            <Input
              key={String(field.key)}
              label={field.label}
              hint={field.hint}
              type="number"
              value={String(form[field.key] ?? 0)}
              onChange={(value) => set(field.key, Number(value || 0) as never)}
            />
          ))}
          <Input
            label="站点时区"
            value={form.timezone}
            onChange={(value) => set('timezone', value)}
            hint="IANA 时区，如 Asia/Shanghai；用于每日配额重置"
            inputDir="ltr"
          />
        </div>
      </PageSection>

      <PageSection title="开关" description="影响用户可执行的操作">
        <div className="flex flex-col divide-y divide-separator-border">
          {BOOLEAN_FIELDS.map((field) => (
            <div
              key={String(field.key)}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div>
                <p className="text-body-medium text-text-primary">
                  {field.label}
                </p>
                {field.hint ? (
                  <p className="text-caption-1-regular text-text-tertiary">
                    {field.hint}
                  </p>
                ) : null}
              </div>
              <Switch
                isSelected={Boolean(form[field.key])}
                onChange={(selected) => set(field.key, selected as never)}
              />
            </div>
          ))}
        </div>
      </PageSection>
    </div>
  )
}
