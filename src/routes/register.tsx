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
import { Input } from '#/components/base/input/input'
import { Select, SelectItem } from '#/components/base/select/select'
import { toast } from '#/components/base/toast/toast'
import { TemplateCopyProvider } from '#/components/foundations/template-copy/template-copy'
import { ThemeCorner } from '#/components/application/theme/theme-corner'
import { authClient } from '#/lib/auth-client'
import { usePowHeaders } from '#/lib/pow-client'
import { PowStatusLine } from '#/components/application/auth/pow-status'
import { clearUserCaches, loginConfigQuery } from '#/lib/api'
import {
  composeEmailAddress,
  emailDomainWhitelistMessage,
  emailPrefixError,
  isEmailDomainAllowed,
  normalizeEmailPrefix,
} from '#/lib/email-domain'

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
  // 白名单模式下邮箱由「前缀 + 下拉后缀」拼成，后缀只可能来自管理员配置
  const [emailPrefix, setEmailPrefix] = useState('')
  const [emailDomain, setEmailDomain] = useState(
    auth.emailPassword.domainWhitelist.domains[0] ?? '',
  )
  const pow = usePowHeaders()

  const emailEnabled = auth.emailPassword.enabled
  const verificationRequired = auth.emailPassword.verificationRequired
  const whitelist = auth.emailPassword.domainWhitelist
  // 开启但没有域名时服务端会拒绝所有注册，页面上也要说清楚
  const whitelistBlocksAll = whitelist.enabled && whitelist.domains.length === 0
  const whitelistActive = whitelist.enabled && whitelist.domains.length > 0
  // 配置可能在页面打开后被改（删掉了选中项），回落到第一个可用后缀
  const selectedDomain = whitelist.domains.includes(emailDomain)
    ? emailDomain
    : (whitelist.domains[0] ?? '')
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
    const password = String(data.get('password') ?? '')
    const confirmPassword = String(data.get('confirmPassword') ?? '')

    let email = String(data.get('email') ?? '')
    if (whitelistActive) {
      const prefix = String(data.get('emailPrefix') ?? '')
      const prefixIssue = emailPrefixError(prefix)
      if (prefixIssue) {
        toast.error(prefixIssue)
        return
      }
      const composed = composeEmailAddress(prefix, selectedDomain)
      if (!composed) {
        toast.error('请选择有效的邮箱后缀')
        return
      }
      email = composed
    }

    const name = String(data.get('name') ?? '') || email.split('@')[0]
    // 服务端才是最终判定；这里提前拦一次，省掉一次注定失败的请求
    if (whitelist.enabled && !isEmailDomainAllowed(email, whitelist.domains)) {
      toast.error(emailDomainWhitelistMessage(whitelist.domains))
      return
    }
    if (password.length < 8) {
      toast.error('密码至少需要 8 位字符')
      return
    }
    if (password !== confirmPassword) {
      toast.error('两次输入的密码不一致')
      return
    }

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
            !emailEnabled
              ? '选择一种登录方式创建账号'
              : whitelistBlocksAll
                ? '邮箱注册暂不可用，请联系管理员'
                : whitelistActive
                  ? '邮箱后缀由管理员限定，填写前缀并选择后缀即可注册'
                  : '创建账号后即可生成长期与临时邮箱'
          }
          providers={[]}
          showEmailForm={emailEnabled && !whitelistBlocksAll}
          emailField={
            whitelistActive ? (
              <EmailPrefixField
                prefix={emailPrefix}
                onPrefixChange={setEmailPrefix}
                domain={selectedDomain}
                domains={whitelist.domains}
                onDomainChange={setEmailDomain}
              />
            ) : undefined
          }
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

/**
 * 白名单模式下的邮箱字段：用户只填前缀，后缀从管理员给定的列表里选。
 *
 * 后缀不接受手输，因此请求里出现的域名必然是白名单内的那一个；
 * 服务端钩子仍会独立校验，这条路径只是让用户少走一次注定失败的提交。
 */
function EmailPrefixField({
  prefix,
  onPrefixChange,
  domain,
  domains,
  onDomainChange,
}: {
  prefix: string
  onPrefixChange: (value: string) => void
  domain: string
  domains: string[]
  onDomainChange: (domain: string) => void
}) {
  // 归一后的前缀用于演示完整地址；还不合法时按原样显示，避免输入看起来被吞掉
  const localPart = normalizeEmailPrefix(prefix) ?? prefix.trim()
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <Input
          name="emailPrefix"
          label="邮箱前缀"
          placeholder="your-name"
          value={prefix}
          onChange={onPrefixChange}
          autoComplete="username"
          inputDir="ltr"
          isRequired
          className="min-w-0 flex-1"
        />
        <Select
          label="邮箱后缀"
          selectedKey={domain}
          onSelectionChange={(key) => onDomainChange(String(key))}
          className="max-w-[58%] shrink-0"
        >
          {domains.map((item) => (
            <SelectItem key={item} id={item} textValue={`@${item}`}>
              <span dir="ltr">@{item}</span>
            </SelectItem>
          ))}
        </Select>
      </div>
      <p className="text-caption-1-regular text-text-tertiary">
        将注册为{' '}
        <span dir="ltr" className="text-text-secondary">
          {localPart || 'your-name'}@{domain}
        </span>
      </p>
    </div>
  )
}
