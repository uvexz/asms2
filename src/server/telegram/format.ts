import { escapeHtml } from '#/server/mail/content'

/**
 * Telegram 消息渲染（统一 HTML parse_mode）。
 * 所有来自邮件的字段都必须 escapeHtml，否则主题里的 < > 会让整条消息解析失败。
 */

export const KIND_LABEL: Record<'permanent' | 'temp', string> = {
  permanent: '长期邮箱',
  temp: '临时邮箱',
}

export function truncateText(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1)}…`
}

/** 邮件正文里的空行压缩，避免 TG 消息被大段空白拉长 */
function normalizeBody(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const CODE_PATTERNS: RegExp[] = [
  /(?:验证码|校验码|确认码|动态码|动态密码|登录密码|口令|verification\s*code|security\s*code|one[-\s]?time\s*(?:code|password)|passcode|otp)[^0-9]{0,16}([0-9]{4,8})(?![0-9])/i,
  /(?<![0-9])([0-9]{4,8})[^0-9]{0,16}(?:验证码|校验码|verification\s*code|security\s*code)/i,
  /^\s*([0-9]{6})\s*$/m,
]

/** 从主题 + 摘要 + 正文前 2KB 里提取验证码；宁可漏报也不猜错 */
export function extractVerificationCode(
  ...sources: (string | null | undefined)[]
): string | null {
  const haystack = sources.filter(Boolean).join('\n').slice(0, 2500)
  if (!haystack) return null
  for (const pattern of CODE_PATTERNS) {
    const match = haystack.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

export function formatShortTime(ms: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .format(new Date(ms))
      .replace(/\//g, '-')
  } catch {
    return new Date(ms).toISOString().slice(5, 16).replace('T', ' ')
  }
}

export function formatRemaining(expiresAt: number | null): string {
  if (!expiresAt) return ''
  const diff = expiresAt - Date.now()
  if (diff <= 0) return '已失效'
  const minutes = Math.ceil(diff / 60_000)
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest > 0 ? `剩 ${hours} 小时 ${rest} 分` : `剩 ${hours} 小时`
  }
  return `剩 ${minutes} 分钟`
}

export interface InboundNotificationInput {
  kind: 'permanent' | 'temp'
  mailboxAddress: string
  fromName: string | null
  fromAddress: string
  subject: string | null
  snippet: string | null
  receivedAt: number
  timezone: string
  code: string | null
}

export function renderInboundNotification(
  input: InboundNotificationInput,
): string {
  const from = input.fromName
    ? `${input.fromName} <${input.fromAddress}>`
    : input.fromAddress
  const lines = [
    `<b>新邮件 · ${KIND_LABEL[input.kind]}</b>`,
    `收件：<code>${escapeHtml(input.mailboxAddress)}</code>`,
    `发件：${escapeHtml(from)}`,
    `主题：${escapeHtml(input.subject?.trim() || '(无主题)')}`,
  ]

  if (input.code) {
    lines.push(`验证码：<b>${escapeHtml(input.code)}</b>`)
  }

  const snippet = truncateText(normalizeBody(input.snippet ?? ''), 300)
  if (snippet) {
    lines.push('', escapeHtml(snippet))
  }

  lines.push('', `<i>${formatShortTime(input.receivedAt, input.timezone)}</i>`)
  return lines.join('\n')
}

export interface MessageDetailInput {
  mailboxAddress: string
  subject: string | null
  fromName: string | null
  fromAddress: string
  to: string[]
  receivedAt: number
  timezone: string
  body: string | null
  attachmentCount: number
}

export function renderMessageDetail(input: MessageDetailInput): string {
  const from = input.fromName
    ? `${input.fromName} <${input.fromAddress}>`
    : input.fromAddress
  const head = [
    `<b>${escapeHtml(input.subject?.trim() || '(无主题)')}</b>`,
    `发件：${escapeHtml(from)}`,
    `收件：${escapeHtml(input.mailboxAddress)}`,
  ]
  if (input.to.length > 1) {
    head.push(`其他收件人：${escapeHtml(input.to.slice(1).join(', '))}`)
  }
  head.push(`时间：${formatShortTime(input.receivedAt, input.timezone)}`)
  if (input.attachmentCount > 0) {
    head.push(`附件：${input.attachmentCount} 个（请在网页端查看）`)
  }

  const body = truncateText(normalizeBody(input.body ?? ''), 3200)
  const parts = [head.join('\n')]
  parts.push(
    body
      ? `\n${escapeHtml(body)}`
      : '\n<i>（无纯文本正文，请到网页端查看）</i>',
  )
  return parts.join('\n')
}

export interface MailboxSummary {
  address: string
  kind: 'permanent' | 'temp'
  unreadCount: number
  expiresAt: number | null
  retained: boolean
}

export function renderMailboxList(items: MailboxSummary[]): string {
  if (items.length === 0) {
    return '<b>我的邮箱</b>\n还没有邮箱，发送 /new 创建一个临时邮箱。'
  }

  const lines = [`<b>我的邮箱</b>（${items.length} 个）`]
  for (const item of items) {
    const badges: string[] = [KIND_LABEL[item.kind]]
    if (item.unreadCount > 0) badges.push(`${item.unreadCount} 未读`)
    if (item.kind === 'temp') {
      const remaining = item.retained
        ? '已永久保留'
        : formatRemaining(item.expiresAt)
      if (remaining) badges.push(remaining)
    }
    lines.push(
      `• <code>${escapeHtml(item.address)}</code> · ${badges.join(' · ')}`,
    )
  }
  return lines.join('\n')
}

export function renderInboxPreview(input: {
  address: string
  items: {
    subject: string | null
    fromAddress: string
    receivedAt: number
    isRead: boolean
  }[]
  timezone: string
}): string {
  if (input.items.length === 0) {
    return `<b>${escapeHtml(input.address)}</b>\n收件箱是空的。`
  }
  const lines = [
    `<b>${escapeHtml(input.address)}</b> · 最近 ${input.items.length} 封`,
  ]
  for (const item of input.items) {
    const dot = item.isRead ? '·' : '●'
    lines.push(
      `${dot} ${escapeHtml(item.subject?.trim() || '(无主题)')} — ${escapeHtml(item.fromAddress)} · ${formatShortTime(item.receivedAt, input.timezone)}`,
    )
  }
  return lines.join('\n')
}
