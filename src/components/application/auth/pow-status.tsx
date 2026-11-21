import { RiErrorWarningLine, RiShieldCheckLine } from '@remixicon/react'

import { Spinner } from '#/components/base/spinner/spinner'
import type { PowStatus } from '#/lib/pow-client'
import { cx } from '#/utils/cx'

/**
 * 认证表单下方的人机校验状态。校验本身在后台自动完成，不需要用户操作；
 * 这一行只是让人知道它在进行、已通过，或失败了可以重试。
 */
export function PowStatusLine({
  status,
  onRetry,
  className,
}: {
  status: PowStatus
  onRetry: () => void
  className?: string
}) {
  if (status === 'idle' || status === 'disabled') return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'flex items-center gap-1.5 text-caption-1-regular',
        status === 'error' ? 'text-text-error-primary' : 'text-text-tertiary',
        className,
      )}
    >
      {status === 'solving' ? (
        <>
          <Spinner size="xs" aria-hidden />
          <span>正在进行安全校验…</span>
        </>
      ) : status === 'ready' ? (
        <>
          <RiShieldCheckLine
            className="size-3.5 text-foreground-icon-tertiary"
            aria-hidden
          />
          <span>已通过安全校验</span>
        </>
      ) : (
        <>
          <RiErrorWarningLine className="size-3.5" aria-hidden />
          <span>安全校验失败</span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-sm underline underline-offset-2 outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
          >
            重试
          </button>
        </>
      )}
    </div>
  )
}
