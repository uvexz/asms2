/** 4xx 类错误重试也不会变好，直接失败让用户看到原因 */
const NON_RETRYABLE = new Set<string>([
  'unauthorized',
  'forbidden',
  'validation_failed',
  'not_found',
  'conflict',
  'mailbox_limit_reached',
  'address_taken',
  'quota_exceeded',
  'rate_limited',
  'not_implemented',
])

export function errorCodeOf(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' && code ? code : undefined
  }
  return undefined
}

export function isNonRetryableError(error: unknown): boolean {
  const code = errorCodeOf(error)
  return code ? NON_RETRYABLE.has(code) : false
}

export function errorMessageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '请求失败，请稍后重试'
}

export function isUnauthorizedError(error: unknown): boolean {
  return errorCodeOf(error) === 'unauthorized'
}

export function isNotFoundError(error: unknown): boolean {
  return errorCodeOf(error) === 'not_found'
}
