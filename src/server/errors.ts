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
    const message =
      error instanceof Error ? error.message : '服务器内部错误，请稍后重试'
    console.error('[asms2] unhandled error:', error)
    return { ok: false, error: { code: 'internal', message } }
  }
}
