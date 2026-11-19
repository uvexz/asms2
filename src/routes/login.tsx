import { useEffect, useState } from 'react'
import {
  createFileRoute,
  getRouteApi,
  useNavigate,
} from '@tanstack/react-router'

import { AuthCard } from '@/components/application/auth/auth-card'
import { LoginMethodButtons } from '@/components/application/auth/method-buttons'
import type { LoginSocialMethod } from '@/components/application/auth/method-buttons'
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
  'or continue with': '或使用以下方式登录',
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

function isConditionalUiSupported() {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof window.PublicKeyCredential.isConditionalMediationAvailable ===
      'function'
  )
}

function LoginPage() {
  const navigate = useNavigate()
  const { site, auth } = rootApi.useLoaderData()
  const [loading, setLoading] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)

  const social: LoginSocialMethod[] = auth.social
  const emailEnabled = auth.emailPassword.enabled
  const verificationRequired = auth.emailPassword.verificationRequired
  const passkeyEnabled = auth.passkey.enabled
  const hasAnyMethod = emailEnabled || social.length > 0 || passkeyEnabled

  async function goAfterLogin(emailVerified: boolean) {
    if (verificationRequired && !emailVerified) {
      await navigate({ to: '/verify-email' })
      return
    }
    await navigate({ to: '/mail', search: { folder: 'inbox' } })
  }

  async function handleSubmit(data: FormData) {
    const email = String(data.get('email') ?? '')
    const password = String(data.get('password') ?? '')
    setLoading(true)
    const { data: result, error } = await authClient.signIn.email({
      email,
      password,
      callbackURL: '/mail',
    })
    setLoading(false)
    if (error) {
      toast.error(error.message ?? '登录失败，请检查邮箱与密码')
      return
    }
    await goAfterLogin(Boolean(result.user.emailVerified))
  }

  async function handleProvider(provider: string) {
    // genericOAuth 复用标准 signIn.social，provider 即各 OIDC 的自定义 providerId
    await authClient.signIn.social({
      provider,
      callbackURL: '/mail',
    })
  }

  async function handlePasskey() {
    setPasskeyBusy(true)
    const result = await authClient.signIn.passkey({
      fetchOptions: {
        onSuccess: () => {
          void navigate({ to: '/mail', search: { folder: 'inbox' } })
        },
      },
    })
    setPasskeyBusy(false)
    if (result.error) {
      toast.error(result.error.message ?? 'Passkey 登录失败')
    }
  }

  // Conditional UI：浏览器在邮箱输入框上自动提示已保存的通行密钥
  useEffect(() => {
    if (!passkeyEnabled || !isConditionalUiSupported()) return
    let cancelled = false
    void window.PublicKeyCredential.isConditionalMediationAvailable().then(
      (available) => {
        if (!available || cancelled) return
        void authClient.signIn.passkey({
          autoFill: true,
          fetchOptions: {
            onSuccess: () => {
              void navigate({ to: '/mail', search: { folder: 'inbox' } })
            },
          },
        })
      },
    )
    return () => {
      cancelled = true
    }
  }, [passkeyEnabled, navigate])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background-full px-4 py-10">
      <TemplateCopyProvider translate={translateAuth}>
        <AuthCard
          mode="signin"
          title={site?.siteName ? `登录 ${site.siteName}` : '登录'}
          description={
            emailEnabled
              ? '用邮箱和密码登录，或选择其他登录方式'
              : '选择一种登录方式继续'
          }
          providers={[]}
          showEmailForm={emailEnabled}
          passkeyAutofill={passkeyEnabled}
          methodsSlot={
            hasAnyMethod ? (
              <LoginMethodButtons
                social={social}
                passkeyEnabled={passkeyEnabled}
                onSocial={(provider) => void handleProvider(provider)}
                onPasskey={() => void handlePasskey()}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-border-button-default p-4 text-center text-caption-1-regular text-text-tertiary">
                管理员尚未配置登录方式，请联系管理员。
              </p>
            )
          }
          onSubmit={handleSubmit}
          switchHref="/register"
          forgotHref="/forgot-password"
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
      {passkeyBusy ? (
        <p className="text-caption-1-regular text-text-tertiary">
          正在等待 Passkey 验证…
        </p>
      ) : null}
    </div>
  )
}
