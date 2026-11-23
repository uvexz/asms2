import { useState } from 'react'
import {
  Link,
  createFileRoute,
  getRouteApi,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { AuthCard } from '#/components/application/auth/auth-card'
import { LoginMethodButtons } from '#/components/application/auth/method-buttons'
import type { LoginSocialMethod } from '#/components/application/auth/method-buttons'
import { toast } from '#/components/base/toast/toast'
import { TemplateCopyProvider } from '#/components/foundations/template-copy/template-copy'
import { ThemeCorner } from '#/components/application/theme/theme-corner'
import { authClient } from '#/lib/auth-client'
import { usePowHeaders } from '#/lib/pow-client'
import { PowStatusLine } from '#/components/application/auth/pow-status'
import { clearUserCaches, loginConfigQuery } from '#/lib/api'

import { translateAuth } from './login'

const rootApi = getRouteApi('__root__')

export const Route = createFileRoute('/register')({
  head: () => ({ meta: [{ title: '注册' }] }),
  loader: ({ context }) => context.queryClient.query(loginConfigQuery),
  component: RegisterPage,
})

function RegisterPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { site } = rootApi.useLoaderData()
  const auth = Route.useLoaderData()
  const [loading, setLoading] = useState(false)
  const [socialBusy, setSocialBusy] = useState<string | null>(null)
  const pow = usePowHeaders()

  const emailEnabled = auth.emailPassword.enabled
  const verificationRequired = auth.emailPassword.verificationRequired
  const social: LoginSocialMethod[] = auth.social
  // Passkey 只能绑定已有账号，注册页不算可用方式
  const hasAnyMethod = emailEnabled || social.length > 0

  if (!site.registrationEnabled) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background-full px-4">
        <div className="max-w-sm rounded-3xl border border-border-button-default bg-background-primary-default p-8 text-center">
          <h1 className="text-title-3-semibold text-text-primary">
            注册已关闭
          </h1>
          <p className="mt-2 text-body-regular text-text-secondary">
            当前站点不接受新用户注册，请联系管理员开通账号。
          </p>
        </div>
      </div>
    )
  }

  async function handleSubmit(data: FormData) {
    if (loading) return
    const email = String(data.get('email') ?? '')
    const password = String(data.get('password') ?? '')
    const name = String(data.get('name') ?? '') || email.split('@')[0]

    setLoading(true)
    try {
      const { data: result, error } = await authClient.signUp.email({
        email,
        password,
        name,
        callbackURL: '/mail',
        fetchOptions: { headers: await pow.getHeaders() },
      })
      if (error) {
        toast.error(error.message ?? '注册失败，请稍后重试')
        return
      }
      clearUserCaches(queryClient)
      await router.invalidate()
      if (verificationRequired && !result.user.emailVerified) {
        await navigate({ to: '/verify-email' })
        return
      }
      await navigate({ to: '/mail', search: { folder: 'inbox' } })
    } catch {
      toast.error('注册失败，请检查网络后重试')
    } finally {
      setLoading(false)
    }
  }

  async function handleProvider(provider: string) {
    if (socialBusy) return
    setSocialBusy(provider)
    try {
      const { error } = await authClient.signIn.social({
        provider,
        callbackURL: '/mail',
      })
      if (error) toast.error(error.message ?? '发起注册失败，请稍后重试')
    } catch {
      toast.error('发起注册失败，请检查网络后重试')
    } finally {
      setSocialBusy(null)
    }
  }

  async function handlePasskey() {
    // Passkey 只能绑定已有账号，注册页不提供（用户可先注册再到设置里绑定）
    toast.info('请先使用其他方式注册，然后在个人设置里绑定 Passkey')
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background-full px-4 py-10">
      <ThemeCorner />
      <TemplateCopyProvider translate={translateAuth}>
        <AuthCard
          mode="signup"
          title={`加入 ${site.siteName}`}
          description={
            emailEnabled
              ? '创建账号后即可生成长期与临时邮箱'
              : '选择一种登录方式创建账号'
          }
          providers={[]}
          showEmailForm={emailEnabled}
          methodsSlot={
            hasAnyMethod ? (
              <LoginMethodButtons
                social={social}
                passkeyEnabled={false}
                action="继续"
                onSocial={(provider) => void handleProvider(provider)}
                onPasskey={handlePasskey}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-border-button-default p-4 text-center text-caption-1-regular text-text-tertiary">
                管理员尚未配置登录方式，请联系管理员。
              </p>
            )
          }
          onSubmit={handleSubmit}
          switchHref="/login"
          centered
          confirmPassword
          className="w-full max-w-[420px]"
          footnote={
            <>
              注册即表示同意{' '}
              <Link
                to="/terms"
                className="rounded-sm text-text-secondary underline underline-offset-3 outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
              >
                服务条款
              </Link>{' '}
              和{' '}
              <Link
                to="/privacy"
                className="rounded-sm text-text-secondary underline underline-offset-3 outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
              >
                隐私政策
              </Link>
              <span className="mt-1 block">
                {site.footerText ?? `${site.siteName} · A Simple Mail Server`}
              </span>
            </>
          }
        />
      </TemplateCopyProvider>
      {emailEnabled ? (
        <PowStatusLine status={pow.status} onRetry={pow.retry} />
      ) : null}
      {socialBusy ? (
        <p className="text-caption-1-regular text-text-tertiary">正在跳转…</p>
      ) : null}
      {loading ? (
        <p className="text-caption-1-regular text-text-tertiary">
          正在创建账号…
        </p>
      ) : null}
    </div>
  )
}
