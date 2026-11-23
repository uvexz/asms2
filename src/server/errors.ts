export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'validation_failed'
  | 'not_found'
  | 'conflict'
  | 'mailbox_limit_reached'
  | 'address_taken'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'provider_error'
  | 'provider_retryable'
  | 'send_uncertain'
  | 'not_implemented'
  | 'internal'

export class AppError extends Error {
  code: ErrorCode
  status: number
  details?: unknown

  constructor(
    code: ErrorCode,
    message: string,
    status = 400,
    details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/** 递归识别 SQLite 唯一约束错误(Drizzle 会把 LibsqlError 包在 cause 里)。 */
export function isUniqueConstraintError(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const record = current as {
      code?: unknown
      message?: unknown
      cause?: unknown
    }
    const code = typeof record.code === 'string' ? record.code : ''
    const message = typeof record.message === 'string' ? record.message : ''
    if (
      /SQLITE_CONSTRAINT|UNIQUE_CONSTRAINT/i.test(code) ||
      /unique constraint|constraint failed/i.test(message)
    ) {
      return true
    }
    current = record.cause
  }
  return false
}

export interface SafeErrorLog {
  name: string
  message: string
  code?: string
}

/** 只保留可安全写入日志的字段,绝不序列化 SQL params / 请求体。 */
export function safeErrorLog(error: unknown): SafeErrorLog {
  const record =
    error && typeof error === 'object'
      ? (error as { name?: unknown; message?: unknown; code?: unknown })
      : null
  const code =
    record && typeof record.code === 'string' ? record.code : undefined
  return {
    name:
      record && typeof record.name === 'string' ? record.name : typeof error,
    message:
      record && typeof record.message === 'string'
        ? record.message.slice(0, 500)
        : 'unknown error',
    ...(code ? { code } : {}),
  }
}

export function logError(context: string, error: unknown): void {
  console.error(context, safeErrorLog(error))
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } }

/** 把 service 抛出的预期错误收敛成可序列化结果，避免 RPC 层丢错误码 */
export async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    if (error instanceof AppError) {
      return {
        ok: false,
        error: { code: error.code, message: error.message },
      }
    }
    // 非预期错误可能含 SQL / 内部路径，只写日志，对外统一文案
    logError('[asms2] unhandled error:', error)
    return {
      ok: false,
      error: { code: 'internal', message: '服务器内部错误，请稍后重试' },
    }
  }
}
