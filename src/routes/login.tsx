import { useState } from 'react'
import { createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router'

import { AuthCard } from '@/components/application/auth/auth-card'
import { toast } from '@/components/base/toast/toast'
import { TemplateCopyProvider } from '@/components/foundations/template-copy/template-copy'
import { authClient } from '#/lib/auth-client'

export const DICT: Record<string, string> = {
  'Full name': '昵称',
  Email: '邮箱',
  Password: '密码',
  'Confirm password': '确认密码',
  'Remember me': '记住我',
  'Forgot password?': '忘记密码？',
  'At least 8 characters': '至少 8 位字符',
  'Repeat your password': '再次输入密码',
  'Enter your password': '输入登录密码',
  or: '或',
  'Sign in': '登录',
  'Create account': '创建账号',
  'Verification code': '验证码',
  'Continue with Google': '使用 Google 继续',
  'Continue with GitHub': '使用 GitHub 继续',
  'Continue with Apple': '使用 Apple 继续',
}

export const translateAuth = (text: string) => DICT[text] ?? text

const rootApi = getRouteApi('__root__')

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const { site, providers } = rootApi.useLoaderData()
  const [loading, setLoading] = useState(false)

  const social = (providers ?? [])
    .map((item) => item.providerId)
    .filter(
      (id): id is 'google' | 'github' => id === 'google' || id === 'github',
    )

  async function handleSubmit(data: FormData) {
    const email = String(data.get('email') ?? '')
    const password = String(data.get('password') ?? '')
    setLoading(true)
    const { error } = await authClient.signIn.email({
      email,
      password,
      callbackURL: '/mail',
    })
    setLoading(false)
    if (error) {
      toast.error(error.message ?? '登录失败，请检查邮箱与密码')
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
          mode="signin"
          title={site?.siteName ? `登录 ${site.siteName}` : '登录'}
          description="用邮箱和密码登录，或选择第三方账号"
          providers={social}
          onSubmit={handleSubmit}
          onProvider={handleProvider}
          switchHref="/register"
          centered
          className="w-full max-w-[420px]"
          footnote={
            site?.footerText ??
            `${site?.siteName ?? 'asms2'} · A Simple Mail Server`
          }
        />
      </TemplateCopyProvider>
      {loading ? (
        <p className="text-caption-1-regular text-text-tertiary">正在登录…</p>
      ) : null}
    </div>
  )
}
