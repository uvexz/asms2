import { useEffect, useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import {
  RiLogoutBoxLine,
  RiMailCheckLine,
  RiSendPlaneLine,
} from '@remixicon/react'

import { Button } from '@/components/base/buttons/button'
import { toast } from '@/components/base/toast/toast'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/verify-email')({
  validateSearch: (search: Record<string, unknown>): { verified?: string } =>
    search.verified === '1' ? { verified: '1' } : {},
  beforeLoad: ({ context }) => {
    if (!context.session) {
      throw redirect({ to: '/login' })
    }
    if (
      !context.session.emailVerificationRequired ||
      context.session.emailVerified
    ) {
      throw redirect({ to: '/mail', search: { folder: 'inbox' } })
    }
  },
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const navigate = useNavigate()
  const { session } = Route.useRouteContext()
  const { verified } = Route.useSearch()
  const [sending, setSending] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  // 点完邮件里的链接回来时，cookieCache 可能还是旧值，强制取一次最新会话
  useEffect(() => {
    if (verified !== '1') return
    void (async () => {
      const result = await authClient.getSession({
        query: { disableCookieCache: true },
      })
      if (result.data?.user.emailVerified) {
        await navigate({ to: '/mail', search: { folder: 'inbox' } })
      }
    })()
  }, [verified, navigate])

  async function resend() {
    setSending(true)
    const { error } = await authClient.sendVerificationEmail({
      email: session?.email ?? '',
      callbackURL: '/verify-email?verified=1',
    })
    setSending(false)
    if (error) {
      toast.error(error.message ?? '发送失败，请稍后再试')
      return
    }
    toast.success('验证邮件已发送，请检查收件箱')
    setCooldown(60)
  }

  async function signOut() {
    await authClient.signOut()
    await navigate({ to: '/login' })
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background-full px-4 py-10">
      <div className="w-full max-w-[460px] rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-xs sm:p-8">
        <RiMailCheckLine
          className="size-8 text-foreground-icon-primary"
          aria-hidden
        />
        <h1 className="mt-4 text-title-2-medium text-text-primary">
          验证你的邮箱
        </h1>
        <p className="mt-2 text-body-regular text-text-secondary">
          我们已向{' '}
          <span className="text-body-medium text-text-primary">
            {session?.email}
          </span>{' '}
          发送了一封验证邮件。点击邮件里的链接后即可进入邮箱。
        </p>
        <p className="mt-2 text-caption-1-regular text-text-tertiary">
          没收到？检查一下垃圾邮件，或者重新发送。验证链接 1 小时内有效。
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <Button
            className="w-full justify-center"
            leadingIcon={RiSendPlaneLine}
            onClick={() => void resend()}
            disabled={sending || cooldown > 0}
          >
            {sending
              ? '发送中…'
              : cooldown > 0
                ? `${cooldown}s 后可重新发送`
                : '重新发送验证邮件'}
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-center"
            leadingIcon={RiLogoutBoxLine}
            onClick={() => void signOut()}
          >
            退出登录
          </Button>
        </div>
      </div>
    </div>
  )
}
