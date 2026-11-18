import {
  asAddressList,
  asRecord,
  asString,
  mapInboundAttachments,
} from './email-event'
import { requestJson, trimBaseUrl } from './http'
import { verifyStandardSignature } from './signature'
import {
  ProviderError,
  type DnsRecord,
  type MailProvider,
  type MessageStatus,
  type OutboundMessage,
  type ProviderRuntimeConfig,
  type SendResult,
  type VerifiedWebhookEvent,
} from './types'

const DEFAULT_BASE_URL = 'https://api.ahasend.com'
const MAX_CONVERSATION_RECIPIENTS = 50

/** AhaSend 的 webhook 事件名 → 本地 message.status */
const STATUS_BY_EVENT: Record<string, MessageStatus | undefined> = {
  'message.reception': 'sent',
  'message.transient_error': 'sent',
  'message.delivered': 'delivered',
  'message.bounced': 'bounced',
  'message.failed': 'failed',
  'message.suppressed': 'suppressed',
  'message.complained': 'complained',
}

interface AhaSendDnsRecord {
  type: string
  label?: string
  host: string
  content: string
  required?: boolean
  propagated?: boolean
}

interface AhaSendDomain {
  id: string
  domain: string
  dns_records?: AhaSendDnsRecord[] | null
  dns_valid?: boolean
}

interface AhaSendSendResult {
  data?: {
    id: string | null
    status: 'queued' | 'scheduled' | 'error'
    error?: string | null
  }[]
}

interface AhaSendPayload {
  type?: string
  timestamp?: string
  route_id?: string
  webhook_id?: string
  data?: unknown
}

function accountPath(config: ProviderRuntimeConfig, path: string) {
  const accountId = config.accountId?.trim()
  if (!accountId) {
    throw new ProviderError(
      'AhaSend 需要在服务商配置里填写 Account ID（账号 UUID）',
      { code: 'account_id_missing' },
    )
  }
  const base = trimBaseUrl(config.apiBaseUrl, DEFAULT_BASE_URL)
  return `${base}/v2/accounts/${encodeURIComponent(accountId)}${path}`
}

function parseAhaSendError(status: number, payload: unknown) {
  return {
    message:
      asString(asRecord(payload).message) ?? `AhaSend 返回 HTTP ${status}`,
    code: `http_${status}`,
  }
}

function request<T>(
  config: ProviderRuntimeConfig,
  path: string,
  init: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
  } = {},
) {
  return requestJson<T>({
    url: accountPath(config, path),
    method: init.method,
    body: init.body,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'User-Agent': 'asms2/1.0',
      ...init.headers,
    },
    label: 'AhaSend',
    parseError: parseAhaSendError,
  })
}

function mapStatus(domain: AhaSendDomain) {
  return domain.dns_valid ? 'verified' : 'pending'
}

function mapRecords(
  records: AhaSendDnsRecord[] | null | undefined,
): DnsRecord[] {
  return (records ?? []).map((item) => ({
    record: item.label,
    name: item.host,
    type: item.type,
    value: item.content,
    status: item.propagated ? 'verified' : 'pending',
  }))
}

function wrapContentId(value: string) {
  return value.startsWith('<') ? value : `<${value}>`
}

/** docs: message-id / to / cc / reply-to 由参数管理，塞进 headers 会被拒 */
const RESERVED_HEADERS = new Set([
  'from',
  'to',
  'cc',
  'bcc',
  'reply-to',
  'subject',
  'date',
  'message-id',
])

function sanitizeHeaders(headers: Record<string, string> | undefined) {
  if (!headers) return undefined
  const entries = Object.entries(headers).filter(
    ([key]) => !RESERVED_HEADERS.has(key.toLowerCase()),
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function normalizeRoutingEvent(
  payload: AhaSendPayload,
  eventId: string,
): VerifiedWebhookEvent {
  const data = asRecord(payload.data)
  const providerMessageId =
    asString(data.id) ??
    (asString(payload.timestamp)
      ? `routing_${payload.timestamp}`
      : 'unknown_message')

  const rawHeaders = asRecord(data.headers)
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(rawHeaders)) {
    const text = asString(value)
    if (text) headers[key.toLowerCase()] = text
  }
  // AhaSend 把常用头单独放字段，补回 headers 供线程归并使用
  const headerPairs: [string, string | null][] = [
    ['message-id', asString(data.message_id)],
    ['in-reply-to', asString(data.in_reply_to)],
    ['references', asString(data.references)],
    ['reply-to', asString(data.reply_to)],
  ]
  for (const [key, value] of headerPairs) {
    if (value) headers[key] = value
  }

  const attachments = mapInboundAttachments(data.attachments)
  const receivedAt =
    asString(data.date) ?? asString(payload.timestamp) ?? undefined

  return {
    eventId,
    type: asString(payload.type) ?? 'message.routing',
    kind: 'inbound',
    createdAt: asString(payload.timestamp) ?? undefined,
    data: {
      providerMessageId,
      from: asString(data.from) ?? '',
      to: asAddressList(data.to),
      cc: asAddressList(data.cc),
      bcc: asAddressList(data.bcc),
      subject: asString(data.subject),
      receivedAt,
      attachments,
      // 路由事件已经把正文和附件元数据带过来了，不需要二次拉取
      content: {
        html: asString(data.html_body) ?? undefined,
        text: asString(data.plain_body) ?? undefined,
        headers,
        attachments,
      },
    },
  }
}

export const ahasendProvider: MailProvider = {
  kind: 'ahasend',
  capabilities: {
    send: true,
    receive: true,
    domainApi: true,
    webhook: true,
  },

  async send(
    message: OutboundMessage,
    config: ProviderRuntimeConfig,
  ): Promise<SendResult> {
    const total =
      message.to.length + (message.cc?.length ?? 0) + (message.bcc?.length ?? 0)
    if (total > MAX_CONVERSATION_RECIPIENTS) {
      throw new ProviderError(
        `AhaSend 单封邮件的收件人合计不能超过 ${MAX_CONVERSATION_RECIPIENTS} 个`,
        { code: 'too_many_recipients' },
      )
    }

    const result = await request<AhaSendSendResult>(
      config,
      '/messages/conversation',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': message.idempotencyKey },
        body: {
          from: {
            email: message.from.address,
            name: message.from.name,
          },
          to: message.to.map((item) => ({
            email: item.address,
            name: item.name,
          })),
          cc: message.cc?.length
            ? message.cc.map((item) => ({
                email: item.address,
                name: item.name,
              }))
            : undefined,
          bcc: message.bcc?.length
            ? message.bcc.map((item) => ({
                email: item.address,
                name: item.name,
              }))
            : undefined,
          reply_to: message.replyTo?.[0]
            ? {
                email: message.replyTo[0].address,
                name: message.replyTo[0].name,
              }
            : undefined,
          subject: message.subject,
          html_content: message.html,
          text_content: message.text,
          headers: sanitizeHeaders(message.headers),
          attachments: message.attachments?.map((item) => ({
            base64: true,
            data: item.content,
            content_type: item.contentType ?? 'application/octet-stream',
            file_name: item.filename,
            content_id: item.contentId
              ? wrapContentId(item.contentId)
              : undefined,
          })),
        },
      },
    )

    const first = result.data?.[0]
    if (!first?.id) {
      throw new ProviderError(first?.error ?? 'AhaSend 未返回消息 ID', {
        code: 'send_rejected',
      })
    }

    return {
      providerMessageId: first.id,
      status: first.status === 'scheduled' ? 'queued' : 'sent',
    }
  },

  async getInbound(): Promise<never> {
    // 入站正文由 message.routing 事件直接携带，AhaSend 未提供回查接口
    throw new ProviderError('AhaSend 入站正文随 Webhook 投递，无需二次拉取', {
      code: 'unsupported',
    })
  },

  verifyWebhook(
    rawBody: string,
    headers: Record<string, string>,
    config: ProviderRuntimeConfig,
  ): VerifiedWebhookEvent {
    if (!config.webhookSecret) {
      throw new ProviderError('未配置 Webhook 签名密钥', {
        code: 'webhook_secret_missing',
      })
    }

    // AhaSend 明确要求用原文密钥（带 aha-whsec- / aha-rsec- 前缀），不做 base64 解码
    verifyStandardSignature({
      rawBody,
      headers: {
        id: headers['webhook-id'],
        timestamp: headers['webhook-timestamp'],
        signature: headers['webhook-signature'],
      },
      keys: [Buffer.from(config.webhookSecret, 'utf8')],
      label: 'AhaSend',
    })

    let payload: AhaSendPayload
    try {
      payload = asRecord(JSON.parse(rawBody))
    } catch {
      throw new ProviderError('AhaSend Webhook 载荷不是合法 JSON', {
        code: 'invalid_payload',
      })
    }

    const data = asRecord(payload.data)
    const type = asString(payload.type) ?? 'unknown'
    const eventId =
      asString(headers['webhook-id']) ??
      asString(payload.webhook_id) ??
      asString(data.id) ??
      'unknown'

    if (type === 'message.routing')
      return normalizeRoutingEvent(payload, eventId)

    const status = STATUS_BY_EVENT[type]
    const providerMessageId = asString(data.id)

    if (status && providerMessageId) {
      return {
        eventId,
        type,
        kind: 'status',
        createdAt: asString(payload.timestamp) ?? undefined,
        data: { providerMessageId, status },
      }
    }

    return {
      eventId,
      type,
      kind: 'ignored',
      createdAt: asString(payload.timestamp) ?? undefined,
      data: payload,
    }
  },

  async createDomain(hostname, config) {
    const data = await request<AhaSendDomain>(config, '/domains', {
      method: 'POST',
      body: { domain: hostname },
    })
    return {
      providerDomainId: asString(data.domain) ?? hostname,
      status: mapStatus(data),
      records: mapRecords(data.dns_records),
    }
  },

  async getDomain(providerDomainId, config) {
    const data = await request<AhaSendDomain>(
      config,
      `/domains/${encodeURIComponent(providerDomainId)}`,
    )
    return { status: mapStatus(data), records: mapRecords(data.dns_records) }
  },

  async verifyDomain(providerDomainId, config) {
    await request<AhaSendDomain>(
      config,
      `/domains/${encodeURIComponent(providerDomainId)}/check-dns`,
      { method: 'POST' },
    )
  },
}
