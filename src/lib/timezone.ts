/**
 * IANA 时区校验。`Intl.DateTimeFormat` 遇到非法时区会抛 RangeError，
 * 而站点时区参与配额切日与收件计数，写坏一次会让整条链路 500。
 */
export function isValidTimeZone(timezone: string): boolean {
  if (!timezone.trim()) return false
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/** 读取存量数据时的兜底：非法值退化为 UTC，避免旧数据把请求打挂 */
export function safeTimeZone(timezone: string | null | undefined): string {
  if (timezone && isValidTimeZone(timezone)) return timezone
  return 'UTC'
}
