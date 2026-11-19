import type { ErrorComponentProps } from '@tanstack/react-router'
import { RiErrorWarningLine, RiRefreshLine } from '@remixicon/react'

import { Button, ButtonLink } from '@/components/base/buttons/button'
import { cx } from '@/utils/cx'
import {
  errorMessageOf,
  isNotFoundError,
  isUnauthorizedError,
} from '#/lib/query-error'

interface ErrorStateProps {
  error: unknown
  onRetry?: () => void
  title?: string
  compact?: boolean
  className?: string
}

/**
 * 查询失败时统一展示：区分「未登录 / 不存在 / 其它故障」，
 * 并提供重试入口，避免把错误渲染成空数据。
 */
export function ErrorState({
  error,
  onRetry,
  title = '加载失败',
  compact = false,
  className,
}: ErrorStateProps) {
  const unauthorized = isUnauthorizedError(error)
  const notFound = isNotFoundError(error)
  const heading = unauthorized
    ? '登录状态已失效'
    : notFound
      ? '内容不存在'
      : title
  const message = unauthorized
    ? '请重新登录后再试。'
    : notFound
      ? '它可能已被删除，或你没有访问权限。'
      : errorMessageOf(error)

  return (
    <div
      role="alert"
      className={cx(
        'flex flex-col items-center justify-center gap-3 text-center',
        compact ? 'px-4 py-8' : 'px-6 py-16',
        className,
      )}
    >
      <RiErrorWarningLine
        className="size-8 text-foreground-icon-quaternary"
        aria-hidden
      />
      <p className="text-body-medium text-text-primary">{heading}</p>
      <p className="max-w-sm text-caption-1-regular text-text-secondary">
        {message}
      </p>
      <div className="mt-1 flex items-center gap-2">
        {unauthorized ? (
          <ButtonLink href="/login" size="small">
            去登录
          </ButtonLink>
        ) : null}
        {onRetry ? (
          <Button
            size="small"
            variant="secondary"
            leadingIcon={RiRefreshLine}
            onClick={onRetry}
          >
            重试
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** 路由级错误边界：挂在 errorComponent 上 */
export function RouteErrorState({ error, reset }: ErrorComponentProps) {
  const unauthorized = isUnauthorizedError(error)
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center bg-background-full px-6">
      <div className="w-full max-w-md rounded-3xl border border-border-button-default bg-background-primary-default">
        <ErrorState
          error={error}
          title="页面加载失败"
          onRetry={unauthorized ? undefined : reset}
        />
      </div>
    </div>
  )
}
