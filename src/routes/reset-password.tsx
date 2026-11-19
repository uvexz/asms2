import { useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { RiLockPasswordLine } from '@remixicon/react'

import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { toast } from '@/components/base/toast/toast'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/reset-password')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { token?: string; error?: string } => ({
    token: typeof search.token === 'string' ? search.token : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const navigate = useNavigate()
  const { token, error: linkError } = Route.useSearch()
  const [loading, setLoading] = useState(false)

  const invalid = !token || Boolean(linkError)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || loading) return
    const data = new FormData(event.currentTarget)
    const password = String(data.get('password') ?? '')
    const confirmPassword = String(data.get('confirmPassword') ?? '')
    if (password.length < 8) {
      toast.error('密码至少需要 8 位字符')
      return
    }
    if (password !== confirmPassword) {
      toast.error('两次输入的密码不一致')
      return
    }
    setLoading(true)
    const { error } = await authClient.resetPassword({
      newPassword: password,
      token,
    })
    setLoading(false)
    if (error) {
      toast.error(error.message ?? '重置失败，链接可能已过期')
      return
    }
    toast.success('密码已重置，请使用新密码登录')
    await navigate({ to: '/login' })
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background-full px-4 py-10">
      <div className="w-full max-w-[460px] rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-xs sm:p-8">
        <RiLockPasswordLine
          className="size-8 text-foreground-icon-primary"
          aria-hidden
        />

        {invalid ? (
          <>
            <h1 className="mt-4 text-title-2-medium text-text-primary">
              链接无效或已过期
            </h1>
            <p className="mt-2 text-body-regular text-text-secondary">
              重置密码链接 1
              小时内有效，且只能使用一次。请重新申请一封重置邮件。
            </p>
            <Button
              className="mt-6 w-full justify-center"
              onClick={() => void navigate({ to: '/forgot-password' })}
            >
              重新发送重置邮件
            </Button>
            <Link
              to="/login"
              className="mt-4 block text-center text-body-regular text-accent-600 hover:underline"
            >
              返回登录
            </Link>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-title-2-medium text-text-primary">
              设置新密码
            </h1>
            <p className="mt-2 text-body-regular text-text-secondary">
              输入新的登录密码。重置成功后，当前账号在其他设备上的登录状态会失效。
            </p>
            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
              <Input
                name="password"
                type="password"
                label="新密码"
                placeholder="至少 8 位字符"
                autoComplete="new-password"
                isRequired
              />
              <Input
                name="confirmPassword"
                type="password"
                label="确认新密码"
                placeholder="再次输入新密码"
                autoComplete="new-password"
                isRequired
              />
              <Button
                type="submit"
                className="w-full justify-center"
                disabled={loading}
              >
                {loading ? '保存中…' : '重置密码'}
              </Button>
            </form>
            <Link
              to="/login"
              className="mt-6 block text-center text-body-regular text-accent-600 hover:underline"
            >
              返回登录
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
