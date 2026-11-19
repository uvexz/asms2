import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { formatAddress } from '#/lib/email-address'

import { asAddressList, asRecord, asString } from './email-event'
import { requestJson, trimBaseUrl } from './http'
import { ProviderError } from './types'
import type {
  DnsRecord,
  InboundAttachmentMeta,
  InboundContent,
  MailProvider,
  MessageStatus,
  OutboundMessage,
  ProviderDomainSummary,
  ProviderRuntimeConfig,
  SendResult,
  VerifiedWebhookEvent,
} from './types'

/**
 * Reloop（https://reloop.sh）是「事务邮件 + 营销 + 收件箱」一体化的服务商。
 *
 * - 发件：`POST /api/mail/v1/send`，鉴权头 `x-api-key: rl_...`。
 * - 收件：域名开启 receiving 并发布 MX 后，来信落进 Reloop 的 inbox；
 *   `email.received` 事件只带信封与正文元数据，正文要用 `email_id` 调
 *   `GET /api/inbox/v1/messages/{id}` 回查。
 * - 域名：`POST /api/domain/v1/create`、`GET /api/domain/v1/{id}`、
 *   `POST /api/domain/v1/verify/{id}`（异步，稍后读状态才更新）。
 *
 * 注意两套字段风格：Webhook 载荷是 snake_case，REST 响应是 camelCase，
 * 适配器在边界处归一，业务层看不到差异。
 *
 * 官方文档：https://reloop.sh/llms-docs.txt
 */
const DEFAULT_BASE_URL = 'https://reloop.sh'

/** to / cc / bcc 各自的上限，超了服务端直接 400 */
const MAX_RECIPIENTS_PER_FIELD = 50

/** 签名时间窗（秒），与官方示例一致 */
const SIGNATURE_TOLERANCE_SECONDS = 300

/** 出站事件 → 本地 message.status；open / click / 域名 / 联系人都忽略 */
const STATUS_BY_EVENT: Record<string, MessageStatus | undefined> = {
  'email.sent': 'sent',
  // 软退信服务商还会重试，保持「已发送」
  'email.delivery_delayed': 'sent',
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.failed': 'failed',
  'email.complained': 'complained',
  // 事件目录里已有，管线还没接通；先映射，接通后自动生效
  'email.suppressed': 'suppressed',
}

interface ReloopSendResponse {
  success?: boolean
  /** Email log ID，webhook 里的 email_id 就是它 */
  id?: string | null
  /** 邮件唯一 ID（RFC Message-ID 语义） */
  messageId?: string | null
  status?: string | null
  timestamp?: string | null
}

interface ReloopAttachment {
  id?: string
  filename?: string
  contentType?: string
  contentId?: string | null
  size?: number
}

interface ReloopInboundMessage {
  id?: string
  fromEmail?: string
  fromName?: string | null
  toEmails?: string[]
  ccEmails?: string[]
  bccEmails?: string[]
  subject?: string | null
  textBody?: string | null
  htmlBody?: string | null
  headers?: Record<string, unknown> | null
  date?: string | null
  createdAt?: string | null
  messageId?: string | null
  attachments?: ReloopAttachment[] | null
}

interface ReloopDnsRecord {
  recordType?: string
  recordTypeName?: string
  purpose?: string
  name?: string
  value?: string
  ttl?: string
  priority?: number | null
  status?: string
}

interface ReloopDomain {
  id?: string
  domain?: string
  status?: string
  dnsRecords?: ReloopDnsRecord[] | null
}

function apiUrl(config: ProviderRuntimeConfig, path: string) {
  return `${trimBaseUrl(config.apiBaseUrl, DEFAULT_BASE_URL)}${path}`
}

function parseReloopError(status: number, payload: unknown) {
  const error = asRecord(payload)
  const message =
    asString(error.message) ??
    asString(error.error) ??
    `Reloop 返回 HTTP ${status}`
  // `why` / `fix` 是官方错误体里的补充说明，拼进消息方便后台直接看
  const why = asString(error.why)
  return {
    message: why ? `${message}（${why}）` : message,
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
    url: apiUrl(config, path),
    method: init.method,
    body: init.body,
    headers: {
      'x-api-key': config.apiKey,
      'User-Agent': 'asms2/1.0',
      ...init.headers,
    },
    label: 'Reloop',
    parseError: parseReloopError,
  })
}

/** 服务商状态：active 才算验证通过；suspended 与 failed 都当失败 */
function mapDomainStatus(
  status: string | null | undefined,
): 'verified' | 'pending' | 'failed' {
  if (status === 'active') return 'verified'
  if (status === 'failed' || status === 'suspended') return 'failed'
  return 'pending'
}

function mapRecords(
  records: ReloopDnsRecord[] | null | undefined,
): DnsRecord[] {
  return (records ?? []).flatMap((item) => {
    const type = asString(item.recordType)
    const name = asString(item.name)
    const value = asString(item.value)
    if (!type || !name || !value) return []

    return [
      {
        record:
          asString(item.purpose) ??
          asString(item.recordTypeName)?.toLowerCase(),
        name,
        type,
        value,
        ttl: asString(item.ttl) ?? undefined,
        priority: typeof item.priority === 'number' ? item.priority : undefined,
        status: mapDomainStatus(item.status),
      },
    ]
  })
}

interface SignatureParts {
  timestamp: string[]
  signatures: string[]
}

/** `t=<ts>,v1=<hex>`；同一事件重投时可能出现多个 v1，全部收集 */
function parseSignatureHeader(value: string): SignatureParts {
  const parts: SignatureParts = { timestamp: [], signatures: [] }

  for (const segment of value.split(',')) {
    const index = segment.indexOf('=')
    if (index <= 0) continue
    const key = segment.slice(0, index).trim()
    const raw = segment.slice(index + 1).trim()
    if (!raw) continue

    if (key === 't') parts.timestamp.push(raw)
    if (key === 'v1') parts.signatures.push(raw)
  }

  return parts
}

/** 请求头统一走这里：路由只塞存在的头，索引访问运行时可能是 undefined */
function headerValue(
  headers: Record<string, string>,
  name: string,
): string | null {
  return asString(headers[name])?.trim() ?? null
}

/**
 * 官方签名串是 `${timestamp}.${rawBody}`，HMAC-SHA256 取十六进制，
 * 密钥是端点详情里的 `whsec_...` 原文（不做 base64 解码），
 * 与 Standard Webhooks 的 `v1,<base64>` 不同，所以不复用 signature.ts。
 */
function verifySignature(params: {
  rawBody: string
  headers: Record<string, string>
  secret: string
}) {
  const header = params.headers['reloop-signature'] ?? ''
  const parts = parseSignatureHeader(header)
  const timestampText =
    headerValue(params.headers, 'reloop-timestamp') ??
    parts.timestamp.at(0) ??
    ''

  if (!timestampText || parts.signatures.length === 0) {
    throw new ProviderError('Reloop 缺少签名头（Reloop-Signature）', {
      code: 'invalid_signature',
    })
  }

  const sentAt = Number(timestampText)
  if (!Number.isFinite(sentAt)) {
    throw new ProviderError('Reloop 签名时间戳不合法', {
      code: 'invalid_signature',
    })
  }

  if (
    Math.abs(Math.floor(Date.now() / 1000) - sentAt) >
    SIGNATURE_TOLERANCE_SECONDS
  ) {
    throw new ProviderError('Reloop 签名已过期', { code: 'invalid_signature' })
  }

  const expected = createHmac('sha256', params.secret)
    .update(`${timestampText}.${params.rawBody}`)
    .digest()

  const matches = parts.signatures.some((candidate) => {
    // 非 hex 的候选会被 Buffer.from 截断，长度校验自然会挡掉
    const provided = Buffer.from(candidate, 'hex')
    return (
      provided.length === expected.length && timingSafeEqual(provided, expected)
    )
  })

  if (!matches) {
    throw new ProviderError('Reloop 签名校验失败', {
      code: 'invalid_signature',
    })
  }
}

/** 入站事件里没有附件列表，只能从回查结果拿元数据 */
function mapAttachments(
  items: ReloopAttachment[] | null | undefined,
): InboundAttachmentMeta[] | undefined {
  const mapped = (items ?? []).flatMap((item, index) => {
    const filename = asString(item.filename)
    if (!filename) return []
    return [
      {
        providerAttachmentId: asString(item.id) ?? `att_${index}`,
        filename,
        contentType: asString(item.contentType) ?? 'application/octet-stream',
        size: typeof item.size === 'number' ? item.size : 0,
        contentId: asString(item.contentId),
      },
    ]
  })

  return mapped.length > 0 ? mapped : undefined
}

function normalizeHeaders(
  value: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [key, raw] of Object.entries(asRecord(value))) {
    const text = asString(raw)
    if (text) headers[key.toLowerCase()] = text
  }
  return headers
}

export const reloopProvider: MailProvider = {
  kind: 'reloop',
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
    // 服务商按字段限流，超过 50 个直接 400，这里提前给出可读错误
    for (const [label, list] of [
      ['收件人', message.to],
      ['抄送', message.cc ?? []],
      ['密送', message.bcc ?? []],
    ] as const) {
      if (list.length > MAX_RECIPIENTS_PER_FIELD) {
        throw new ProviderError(
          `Reloop 单封邮件的${label}不能超过 ${MAX_RECIPIENTS_PER_FIELD} 个`,
          { code: 'too_many_recipients' },
        )
      }
    }

    if (!message.html && !message.text) {
      throw new ProviderError('Reloop 要求提供 html 或 text 正文', {
        code: 'invalid_payload',
      })
    }

    const payload = await request<ReloopSendResponse>(
      config,
      '/api/mail/v1/send',
      {
        method: 'POST',
        // 官方支持 Idempotency-Key（也可写在 body 的 idempotency_key），头优先
        headers: { 'Idempotency-Key': message.idempotencyKey },
        body: {
          from: formatAddress(message.from),
          to: message.to.map(formatAddress),
          ...(message.cc?.length ? { cc: message.cc.map(formatAddress) } : {}),
          ...(message.bcc?.length
            ? { bcc: message.bcc.map(formatAddress) }
            : {}),
          ...(message.replyTo?.length
            ? { reply_to: message.replyTo.map(formatAddress) }
            : {}),
          subject: message.subject,
          ...(message.html ? { html: message.html } : {}),
          ...(message.text ? { text: message.text } : {}),
          ...(message.headers && Object.keys(message.headers).length > 0
            ? { headers: message.headers }
            : {}),
          ...(message.attachments?.length
            ? {
                attachments: message.attachments.map((item) => ({
                  filename: item.filename,
                  content: item.content,
                  content_type: item.contentType ?? 'application/octet-stream',
                  ...(item.contentId
                    ? { content_id: item.contentId.replace(/[<>]/g, '') }
                    : {}),
                })),
              }
            : {}),
        },
      },
    )

    // 响应里 id 是 email log ID（webhook 的 email_id），messageId 是 MIME Message-ID
    const providerMessageId =
      asString(payload.id) ?? asString(payload.messageId)
    if (payload.success === false || !providerMessageId) {
      throw new ProviderError('Reloop 未返回邮件 ID（可能被丢弃或限流）', {
        code: 'send_rejected',
      })
    }

    return {
      providerMessageId,
      status: asString(payload.status) === 'scheduled' ? 'queued' : 'sent',
    }
  },

  async getInbound(
    providerMessageId: string,
    config: ProviderRuntimeConfig,
  ): Promise<InboundContent> {
    const data = await request<ReloopInboundMessage>(
      config,
      `/api/inbox/v1/messages/${encodeURIComponent(providerMessageId)}`,
    )

    const headers = normalizeHeaders(data.headers)
    // Reloop 把 Message-ID 单独放字段，补回 headers 供线程归并使用
    const internetMessageId = asString(data.messageId)
    if (internetMessageId && !headers['message-id']) {
      headers['message-id'] = internetMessageId
    }

    // 收件人只出现在 cc 时也要能路由，这里合并；webhook 已给出 to/cc 时以它为准
    const to = [...(data.toEmails ?? []), ...(data.ccEmails ?? [])].filter(
      Boolean,
    )

    const fromAddress = asString(data.fromEmail) ?? ''
    const fromName = asString(data.fromName)

    return {
      html: asString(data.htmlBody) ?? undefined,
      text: asString(data.textBody) ?? undefined,
      headers,
      attachments: mapAttachments(data.attachments),
      to,
      from:
        fromName && fromAddress ? `${fromName} <${fromAddress}>` : fromAddress,
      subject: asString(data.subject),
      receivedAt: asString(data.date) ?? asString(data.createdAt) ?? undefined,
    }
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

    verifySignature({
      rawBody,
      headers,
      secret: config.webhookSecret,
    })

    let payload: Record<string, unknown>
    try {
      payload = asRecord(JSON.parse(rawBody))
    } catch {
      throw new ProviderError('Reloop Webhook 载荷不是合法 JSON', {
        code: 'invalid_payload',
      })
    }

    const type = asString(payload.type) ?? 'unknown'
    const createdAt = asString(payload.created_at) ?? undefined
    const eventId =
      asString(payload.id) ??
      headerValue(headers, 'reloop-id') ??
      `${type}:${createHash('sha256').update(rawBody).digest('hex').slice(0, 32)}`

    const data = asRecord(payload.data)

    if (type === 'email.received') {
      const providerMessageId = asString(data.email_id)
      if (!providerMessageId) {
        throw new ProviderError('Reloop 入站事件缺少 email_id', {
          code: 'invalid_payload',
        })
      }

      const to = asAddressList(data.to)
      if (to.length === 0) {
        throw new ProviderError('Reloop 入站事件缺少收件人', {
          code: 'invalid_payload',
        })
      }

      const fromRaw = asString(data.from) ?? ''
      const fromName = asString(data.from_name)
      // 正文与附件不在事件里：ingestInbound 会用 email_id 调 getInbound 回查
      return {
        eventId,
        type,
        kind: 'inbound',
        createdAt,
        data: {
          providerMessageId,
          from:
            fromName && fromRaw && !fromRaw.includes('<')
              ? `${fromName} <${fromRaw}>`
              : fromRaw,
          to,
          cc: asAddressList(data.cc),
          bcc: [],
          subject: asString(data.subject),
          receivedAt: createdAt,
        },
      }
    }

    const status = STATUS_BY_EVENT[type]
    const providerMessageId = asString(data.email_id)
    if (status && providerMessageId) {
      return {
        eventId,
        type,
        kind: 'status',
        createdAt,
        data: { providerMessageId, status },
      }
    }

    return { eventId, type, kind: 'ignored', createdAt, data: payload }
  },

  async listDomains(config) {
    const domains: ProviderDomainSummary[] = []

    for (let page = 1; page <= 10; page += 1) {
      const data = await request<{
        domains?: ReloopDomain[]
        total?: number
      }>(config, `/api/domain/v1/list?page=${page}&limit=100`)

      const items = data.domains ?? []
      for (const item of items) {
        const id = asString(item.id)
        const hostname = asString(item.domain)?.trim()
        if (!id || !hostname) continue
        domains.push({
          providerDomainId: id,
          hostname,
          status: mapDomainStatus(item.status),
        })
      }

      if (items.length === 0 || typeof data.total !== 'number') break
      if (domains.length >= data.total) break
    }

    return domains
  },

  async createDomain(hostname, config) {
    const data = await request<ReloopDomain>(config, '/api/domain/v1/create', {
      method: 'POST',
      body: {
        domain: hostname.toLowerCase(),
        // 本站两种用途都支持，创建时就把发信与收件一起打开（官方默认也是 true）
        sending_email: true,
        receiving_email: true,
      },
    })

    const providerDomainId = asString(data.id)
    if (!providerDomainId) {
      throw new ProviderError('Reloop 未返回域名 ID', {
        code: 'domain_create_failed',
      })
    }

    return {
      providerDomainId,
      status: mapDomainStatus(data.status),
      records: mapRecords(data.dnsRecords),
    }
  },

  async getDomain(providerDomainId, config) {
    const data = await request<ReloopDomain>(
      config,
      `/api/domain/v1/${encodeURIComponent(providerDomainId)}`,
    )
    return {
      status: mapDomainStatus(data.status),
      records: mapRecords(data.dnsRecords),
    }
  },

  async verifyDomain(providerDomainId, config) {
    // 接口返回 verifying，DNS 检查是异步的；后台随后会调 getDomain 回写状态，
    // 还没出结果时保持 pending，再点一次「验证」即可
    await request<ReloopDomain>(
      config,
      `/api/domain/v1/verify/${encodeURIComponent(providerDomainId)}`,
      { method: 'POST' },
    )
  },
}
