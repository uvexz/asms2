import { AppError } from '#/server/errors'
import type { SiteSettings } from '#/server/settings'

/**
 * 系统保留字：防止普通用户注册出看起来像官方的地址。
 * 保留前缀收到的邮件会统一转投同域名的 admin@；管理员可注册保留前缀。
 */
export const DEFAULT_RESERVED_WORDS = [
  // RFC 2142 必备角色
  'postmaster',
  'abuse',
  'hostmaster',
  'webmaster',
  'security',
  'noc',
  'phishing',
  'spam',
  // 职能信箱
  'admin',
  'administrator',
  'info',
  'contact',
  'support',
  'help',
  'billing',
  'legal',
  'privacy',
  'feedback',
  'sales',
  'marketing',
  'press',
  'hr',
  'jobs',
  'careers',
  'compliance',
  // 机器 / 服务信箱
  'noreply',
  'no-reply',
  'bounce',
  'bounces',
  'mailer-daemon',
  'mailer',
  'daemon',
  'dsn',
  'dmarc',
  // 系统与协议角色
  'root',
  'system',
  'operator',
  'postfix',
  'exim',
  'mail',
  'smtp',
  'imap',
  'pop',
  'pop3',
  'ftp',
  'www',
  'news',
  'usenet',
  'uucp',
]

const LOCAL_PART_RE = /^[a-z0-9]+$/

export function getReservedWords(settings: SiteSettings): string[] {
  if (!settings.reservedWordsJson) return DEFAULT_RESERVED_WORDS
  try {
    const parsed = JSON.parse(settings.reservedWordsJson)
    return Array.isArray(parsed)
      ? [
          ...DEFAULT_RESERVED_WORDS,
          ...parsed
            .map((word) => String(word).trim().toLowerCase())
            .filter(Boolean),
        ]
      : DEFAULT_RESERVED_WORDS
  } catch {
    return DEFAULT_RESERVED_WORDS
  }
}

export function isReservedLocalPart(
  localPart: string,
  settings: SiteSettings,
): boolean {
  return getReservedWords(settings).includes(localPart.toLowerCase())
}

export function validateLocalPart(
  input: string,
  kind: 'permanent' | 'temp',
  settings: SiteSettings,
  options: { allowReserved?: boolean } = {},
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
  if (!options.allowReserved && isReservedLocalPart(localPart, settings)) {
    throw new AppError('validation_failed', '该前缀为系统保留字')
  }
  return localPart
}
