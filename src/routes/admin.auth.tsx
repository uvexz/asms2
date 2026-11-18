import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RiSaveLine } from '@remixicon/react'

import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { Switch } from '@/components/base/switch/switch'
import { Spinner } from '@/components/base/spinner/spinner'
import { toast } from '@/components/base/toast/toast'
import { Chip } from '@/components/base/badges/chip'
import { PageSection } from '@/components/admin/ui'
import {
  adminListAuthProvidersFn,
  adminUpsertAuthProviderFn,
} from '#/server/fns/admin'
import { unwrap } from '#/lib/api'

export const Route = createFileRoute('/admin/auth')({
  component: AdminAuth,
})

const PRESETS = [
  {
    providerId: 'google' as const,
    displayName: 'Google',
    needsIssuer: false,
  },
  {
    providerId: 'github' as const,
    displayName: 'GitHub',
    needsIssuer: false,
  },
  {
    providerId: 'oidc' as const,
    displayName: '通用 OIDC',
    needsIssuer: true,
  },
]

function AdminAuth() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['admin', 'auth-providers'],
    queryFn: async () => unwrap(await adminListAuthProvidersFn()),
  })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'auth-providers'] })
  }

  return (
    <div className="flex flex-col gap-5">
      <PageSection
        title="第三方登录"
        description="保存后 30–60 秒内生效；回调地址为 {站点地址}/api/auth/callback/{providerId}"
      >
        {query.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="size-5" />
          </div>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-3">
          {PRESETS.map((preset) => {
            const existing = (query.data ?? []).find(
              (item) => item.providerId === preset.providerId,
            )
            return (
              <ProviderCard
                key={preset.providerId}
                preset={preset}
                existing={existing}
                onSaved={() => void refresh()}
              />
            )
          })}
        </div>
      </PageSection>
    </div>
  )
}

function ProviderCard({
  preset,
  existing,
  onSaved,
}: {
  preset: (typeof PRESETS)[number]
  existing?:
    | {
        providerId: string
        enabled: boolean
        clientId: string | null
        issuer: string | null
        scopes: string | null
        hasSecret: boolean
      }
    | undefined
  onSaved: () => void
}) {
  const [enabled, setEnabled] = useState(existing?.enabled ?? false)
  const [clientId, setClientId] = useState(existing?.clientId ?? '')
  const [secret, setSecret] = useState('')
  const [issuer, setIssuer] = useState(existing?.issuer ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEnabled(existing?.enabled ?? false)
    setClientId(existing?.clientId ?? '')
    setIssuer(existing?.issuer ?? '')
  }, [existing])

  async function save() {
    setSaving(true)
    const result = await adminUpsertAuthProviderFn({
      data: {
        providerId: preset.providerId,
        displayName: preset.displayName,
        enabled,
        clientId: clientId || null,
        clientSecret: secret || undefined,
        issuer: issuer || null,
      },
    })
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(`${preset.displayName} 配置已保存`)
    setSecret('')
    onSaved()
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border-button-default p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-body-medium text-text-primary">
            {preset.displayName}
          </span>
          {existing?.hasSecret ? <Chip color="lime">已配置</Chip> : null}
        </div>
        <Switch isSelected={enabled} onChange={setEnabled} />
      </div>

      <Input
        label="Client ID"
        value={clientId}
        onChange={setClientId}
        inputDir="ltr"
      />
      <Input
        label="Client Secret"
        type="password"
        placeholder={existing?.hasSecret ? '已保存，留空不修改' : ''}
        value={secret}
        onChange={setSecret}
        inputDir="ltr"
      />
      {preset.needsIssuer ? (
        <Input
          label="Issuer"
          placeholder="https://id.example.com"
          value={issuer}
          onChange={setIssuer}
          inputDir="ltr"
          hint="会自动拼接 /.well-known/openid-configuration"
        />
      ) : null}

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
  )
}
