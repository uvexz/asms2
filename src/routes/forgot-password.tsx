import { useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { RiArrowLeftLine, RiMailSendLine } from '@remixicon/react'

import { Button } from '#/components/base/buttons/button'
import { Input } from '#/components/base/input/input'
import { toast } from '#/components/base/toast/toast'
import { ThemeCorner } from '#/components/application/theme/theme-corner'
import { authClient } from '#/lib/auth-client'
import { loginConfigQuery } from '#/lib/api'

export const Route = createFileRoute('/forgot-password')({
  head: () => ({ meta: [{ title: '找回密码' }] }),
  loader: ({ context }) => context.queryClient.query(loginConfigQuery),
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const auth = Route.useLoaderData()
  const emailEnabled = auth.emailPassword.enabled
  const canSend = auth.emailPassword.canSend
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading) return
    const address = email.trim()
    if (!address) {
      toast.error('请输入邮箱地址')
      return
    }
    setLoading(true)
    const { error } = await authClient.requestPasswordReset({
      email: address,
      redirectTo: '/reset-password',
    })
    setLoading(false)
    if (error) {
      toast.error(error.message ?? '发送失败，请稍后再试')
      return
    }
    // 无论邮箱是否存在都展示同样的结果，避免枚举账号
    setSentTo(address)
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background-full px-4 py-10">
      <ThemeCorner />
      <div className="w-full max-w-[460px] rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-xs sm:p-8">
        <RiMailSendLine
          className="size-8 text-foreground-icon-primary"
          aria-hidden
        />

        {sentTo ? (
          <>
            <h1 className="mt-4 text-title-2-medium text-text-primary">
              查看你的邮箱
            </h1>
            <p className="mt-2 text-body-regular text-text-secondary">
              如果{' '}
              <span className="text-body-medium text-text-primary">
                {sentTo}
              </span>{' '}
              已注册，我们会发送一封重置密码邮件。点击邮件里的链接即可设置新密码。
            </p>
            <p className="mt-2 text-caption-1-regular text-text-tertiary">
              没收到？检查一下垃圾邮件，或确认邮箱地址是否输入正确。链接 1
              小时内有效，只能使用一次。
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Button
                variant="secondary"
                className="w-full justify-center"
                onClick={() => setSentTo(null)}
              >
                使用其他邮箱重试
              </Button>
              <Link
                to="/login"
                className="text-center text-body-regular text-accent-600 hover:underline"
              >
                返回登录
              </Link>
            </div>
          </>
        ) : !emailEnabled ? (
          <>
            <h1 className="mt-4 text-title-2-medium text-text-primary">
              暂不支持找回密码
            </h1>
            <p className="mt-2 text-body-regular text-text-secondary">
              管理员尚未开启邮箱密码登录，请使用其他方式登录，或联系管理员重置密码。
            </p>
            <Link
              to="/login"
              className="mt-6 inline-flex items-center gap-1 text-body-regular text-accent-600 hover:underline"
            >
              <RiArrowLeftLine className="size-4" aria-hidden />
              返回登录
            </Link>
          </>
        ) : !canSend ? (
          <>
            <h1 className="mt-4 text-title-2-medium text-text-primary">
              暂时无法发送邮件
            </h1>
            <p className="mt-2 text-body-regular text-text-secondary">
              站点还没有配置可发信的服务商和已验证域名，重置密码邮件暂时发不出去。
            </p>
            <p className="mt-2 text-caption-1-regular text-text-tertiary">
              请联系管理员在「服务商」与「域名」中完成发信配置后再试。
            </p>
            <Link
              to="/login"
              className="mt-6 inline-flex items-center gap-1 text-body-regular text-accent-600 hover:underline"
            >
              <RiArrowLeftLine className="size-4" aria-hidden />
              返回登录
            </Link>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-title-2-medium text-text-primary">
              找回密码
            </h1>
            <p className="mt-2 text-body-regular text-text-secondary">
              输入注册时使用的邮箱地址，我们会发送一封重置密码邮件。
            </p>
            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
              <Input
                name="email"
                type="email"
                label="邮箱"
                placeholder="you@company.com"
                autoComplete="email"
                value={email}
                onChange={setEmail}
                isRequired
              />
              <Button
                type="submit"
                className="w-full justify-center"
                leadingIcon={RiMailSendLine}
                disabled={loading}
              >
                {loading ? '发送中…' : '发送重置邮件'}
              </Button>
            </form>
            <Link
              to="/login"
              className="mt-6 inline-flex items-center gap-1 text-body-regular text-accent-600 hover:underline"
            >
              <RiArrowLeftLine className="size-4" aria-hidden />
              返回登录
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
