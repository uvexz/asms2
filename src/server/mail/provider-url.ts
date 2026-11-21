import { AppError } from '#/server/errors'

/*
 * 服务商 API 基地址校验。管理员可填，但不能指向本机 / 内网：
 * 既防 SSRF，也防把已保存的 Key 发到内网探测点。
 *
 * 只做字面量校验（WHATWG URL 会把 2130706433、0x7f.1 这类写法规整成点分十进制）；
 * 解析到内网 IP 的公网域名（DNS rebinding）不在这里防，需要出口网络策略兜底。
 */

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true
  }

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }

  if (host.includes(':')) {
    return (
      host === '::' ||
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80') ||
      host.startsWith('::ffff:')
    )
  }
  return false
}

/** undefined = 不修改；空串 = 清空（用适配器默认地址）；其余必须是公网 https 地址 */
export function normalizeApiBaseUrl(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined
  const trimmed = value?.trim()
  if (!trimmed) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new AppError('validation_failed', 'API 基地址不是合法的 URL')
  }
  // 本地开发允许 http / 内网地址，方便接自建网关调试
  const isDev = process.env.NODE_ENV === 'development'
  if (!isDev && url.protocol !== 'https:') {
    throw new AppError('validation_failed', 'API 基地址必须使用 https')
  }
  if (url.username || url.password) {
    throw new AppError('validation_failed', 'API 基地址不能包含账号密码')
  }
  if (!isDev && isPrivateHost(url.hostname)) {
    throw new AppError('validation_failed', 'API 基地址不能指向本机或内网地址')
  }
  return url.toString().replace(/\/+$/, '')
}
