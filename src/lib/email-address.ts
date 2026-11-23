/** 纯函数：地址解析与归一，服务端与适配层共用（不依赖 db / 请求上下文） */

export interface ParsedAddress {
  address: string
  name?: string
}

export function normalizeAddress(input: string): string {
  return input.trim().toLowerCase()
}

/** 支持 `Name <a@b.com>`、`a@b.com`、`"Name" <a@b.com>` */
export function parseAddress(input: string): ParsedAddress {
  const raw = input.trim()
  const angle = raw.match(/^(.*)<([^>]+)>$/)
  if (angle) {
    const name = angle[1].trim().replace(/^"|"$/g, '').trim()
    return {
      address: normalizeAddress(angle[2]),
      name: name || undefined,
    }
  }
  return { address: normalizeAddress(raw) }
}

export function parseAddressList(
  input: string | string[] | null | undefined,
): ParsedAddress[] {
  if (!input) return []
  const list = Array.isArray(input) ? input : splitAddressList(input)
  return list
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseAddress)
}

/** 逗号分隔，但忽略引号与尖括号内部的逗号 */
export function splitAddressList(input: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuote = false
  let inAngle = false

  for (const char of input) {
    if (char === '"') inQuote = !inQuote
    if (char === '<') inAngle = true
    if (char === '>') inAngle = false
    if (char === ',' && !inQuote && !inAngle) {
      result.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) result.push(current)
  return result
}

function sanitizeDisplayName(name: string): string {
  // 防止 CR/LF 头注入、逗号/分号把显示名拆成多个收件人。
  return (
    name
      // eslint-disable-next-line no-control-regex -- 明确过滤控制字符
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/[",;<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

export function formatAddress(address: ParsedAddress): string {
  if (!address.name) return address.address
  const safeName = sanitizeDisplayName(address.name)
  return safeName ? `${safeName} <${address.address}>` : address.address
}

export function splitMailboxAddress(address: string): {
  localPart: string
  domain: string
} {
  const at = address.lastIndexOf('@')
  if (at <= 0) return { localPart: address.toLowerCase(), domain: '' }
  return {
    localPart: address.slice(0, at).toLowerCase(),
    domain: address.slice(at + 1).toLowerCase(),
  }
}
