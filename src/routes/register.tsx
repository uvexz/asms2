import { useState } from 'react'
import { createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router'

import { AuthCard } from '@/components/application/auth/auth-card'
import { toast } from '@/components/base/toast/toast'
import { TemplateCopyProvider } from '@/components/foundations/template-copy/template-copy'
import { authClient } from '#/lib/auth-client'

import { translateAuth } from './login'

const rootApi = getRouteApi('__root__')

export const Route = createFileRoute('/register')({
  component: RegisterPage,
})

function RegisterPage() {
  const navigate = useNavigate()
  const { site, providers } = rootApi.useLoaderData()
  const [loading, setLoading] = useState(false)

  if (site && !site.registrationEnabled) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background-full px-4">
        <div className="max-w-sm rounded-3xl border border-border-button-default bg-background-primary-default p-8 text-center">
          <h1 className="text-title-3-semibold text-text-primary">注册已关闭</h1>
          <p className="mt-2 text-body-regular text-text-secondary">
            当前站点不接受新用户注册，请联系管理员开通账号。
          </p>
        </div>
      </div>
    )
  }

  const social = (providers ?? [])
    .map((item) => item.providerId)
    .filter(
      (id): id is 'google' | 'github' => id === 'google' || id === 'github',
    )

  async function handleSubmit(data: FormData) {
    const email = String(data.get('email') ?? '')
    const password = String(data.get('password') ?? '')
    const name = String(data.get('name') ?? '') || email.split('@')[0]

    setLoading(true)
    const { error } = await authClient.signUp.email({
      email,
      password,
      name,
      callbackURL: '/mail',
    })
    setLoading(false)
    if (error) {
      toast.error(error.message ?? '注册失败，请稍后重试')
      return
    }
    await navigate({ to: '/mail', search: { folder: 'inbox' } })
  }

  async function handleProvider(provider: string) {
    await authClient.signIn.social({ provider, callbackURL: '/mail' })
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background-full px-4 py-10">
      <TemplateCopyProvider translate={translateAuth}>
        <AuthCard
          mode="signup"
          title={`加入 ${site?.siteName ?? 'asms2'}`}
          description="创建账号后即可生成长期与临时邮箱"
          providers={social}
          onSubmit={handleSubmit}
          onProvider={handleProvider}
          switchHref="/login"
          centered
          confirmPassword
          className="w-full max-w-[420px]"
          footnote={site?.footerText ?? `${site?.siteName ?? 'asms2'} · A Simple Mail Server`}
        />
      </TemplateCopyProvider>
      {loading ? (
        <p className="text-caption-1-regular text-text-tertiary">正在创建账号…</p>
      ) : null}
    </div>
  )
}
