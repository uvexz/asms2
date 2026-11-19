import { AppError } from '#/server/errors'
import type { SiteSettings } from '#/server/settings'

/** 系统保留字：防止用户注册出看起来像官方的地址 */
export const DEFAULT_RESERVED_WORDS = [
  'admin',
  'administrator',
  'postmaster',
  'abuse',
  'root',
  'hostmaster',
  'webmaster',
  'noreply',
  'no-reply',
  'mailer-daemon',
  'security',
  'billing',
  'support',
  'system',
]

const LOCAL_PART_RE = /^[a-z0-9]+$/

export function getReservedWords(settings: SiteSettings): string[] {
  if (!settings.reservedWordsJson) return DEFAULT_RESERVED_WORDS
  try {
    const parsed = JSON.parse(settings.reservedWordsJson)
    return Array.isArray(parsed)
      ? [...DEFAULT_RESERVED_WORDS, ...parsed.map(String)]
      : DEFAULT_RESERVED_WORDS
  } catch {
    return DEFAULT_RESERVED_WORDS
  }
}

export function validateLocalPart(
  input: string,
  kind: 'permanent' | 'temp',
  settings: SiteSettings,
): string {
  const localPart = input.trim().toLowerCase()
  const min =
    kind === 'temp' ? settings.tempPrefixMin : settings.permanentPrefixMin
  const max = settings.prefixMax

  if (localPart.length < min) {
    throw new AppError(
      'validation_failed',
      `前缀至少 ${min} 位${kind === 'temp' ? '（临时邮箱）' : ''}`,
    )
  }
  if (localPart.length > max) {
    throw new AppError('validation_failed', `前缀最多 ${max} 位`)
  }
  if (!LOCAL_PART_RE.test(localPart)) {
    throw new AppError('validation_failed', '前缀只能包含小写字母和数字')
  }
  if (getReservedWords(settings).includes(localPart)) {
    throw new AppError('validation_failed', '该前缀为系统保留字')
  }
  return localPart
}
