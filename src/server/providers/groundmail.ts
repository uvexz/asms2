import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import {
  asRecord,
  asString,
  mapInboundAttachments,
  normalizeEmailWebhook,
} from './email-event'
import { requestJson, trimBaseUrl } from './http'
import {
  ProviderError,
  type DnsRecord,
  type InboundContent,
  type MailProvider,
  type OutboundMessage,
  type ProviderRuntimeConfig,
  type SendResult,
  type VerifiedWebhookEvent,
} from './types'

/**
 * Groundmail 只在「发信」上兼容 Resend：同为 `POST /emails` + Bearer + 同名字段，
 * 但验签头、入站取件、域名接口都不一样，所以是独立适配器而不是 custom（Resend 协议）变体。
 */
const DEFAULT_BASE_URL = 'https://api.groundmail.dev'
/** 官方要求签名时间戳 5 分钟内 */
const SIGNATURE_TOLERANCE_SECONDS = 300
/** 入站取件会把附件 base64 一起返回，比常规请求慢，单独放宽超时 */
const INBOUND_TIMEOUT_MS = 30_000

interface GroundmailDnsRecord {
  type: string
  host: string
  value: string
  priority?: number
  /** DKIM / Domain ownership / Inbound receiving / DMARC */
  purpose?: string
  already_set?: boolean
}

interface GroundmailDomainResponse {
  domain?: {
    id?: string
    name?: string
    status?: string
    inbound_status?: string | null
    inbound_error?: string | null
  }
  records?: GroundmailDnsRecord[] | null
  /** 开启入站后才有 MX，需要一并展示给管理员 */
  inbound_records?: GroundmailDnsRecord[] | null
  inbound_note?: string | null
}

interface GroundmailSendResult {
  id: string
  status?: 'queued' | 'scheduled'
}

interface GroundmailReceivedEmail {
  id: string
  subject?: string | null
  message_id?: string | null
  in_reply_to?: string | null
  references?: string[] | string | null
  text_body?: string | null
  html_body?: string | null
  attachments?:
    | {
        filename?: string | null
        content_type?: string | null
        content_id?: string | null
        size?: number | null
        data?: string | null
      }[]
    | null
}

function apiUrl(config: ProviderRuntimeConfig, path: string) {
  return `${trimBaseUrl(config.apiBaseUrl, DEFAULT_BASE_URL)}${path}`
}

function parseGroundmailError(status: number, payload: unknown) {
  const error = asRecord(asRecord(payload).error)
  return {
    message: asString(error.message) ?? `Groundmail 返回 HTTP ${status}`,
    code: asString(error.code) ?? `http_${status}`,
  }
}

function request<T>(
  config: ProviderRuntimeConfig,
  path: string,
  init: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
    timeoutMs?: number
  } = {},
) {
  return requestJson<T>({
    url: apiUrl(config, path),
    method: init.method,
    body: init.body,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'User-Agent': 'asms2/1.0',
      ...init.headers,
    },
    label: 'Groundmail',
    timeoutMs: init.timeoutMs,
    parseError: parseGroundmailError,
  })
}

function mapStatus(status: string | undefined): string {
  if (status === 'verified') return 'verified'
  if (status === 'failed' || status === 'temporary_failure') return 'failed'
  return 'pending'
}

/** purpose 当记录标签展示；已存在的 DMARC 记录标 already_set，免得管理员以为要新建 */
function mapRecords(
  records: GroundmailDnsRecord[] | null | undefined,
  inboundRecords?: GroundmailDnsRecord[] | null,
): DnsRecord[] {
  const merged = [...(records ?? []), ...(inboundRecords ?? [])]
  const seen = new Set<string>()
  const result: DnsRecord[] = []

  for (const item of merged) {
    const key = `${item.type}|${item.host}|${item.value}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      record: item.purpose,
      name: item.host,
      type: item.type,
      value: item.value,
      priority: item.priority,
      status: item.already_set ? 'already_set' : undefined,
    })
  }

  return result
}

function wrapContentId(value: string) {
  return value.startsWith('<') ? value : `<${value}>`
}

/** references 可能是数组也可能是字符串，统一成邮件头里的空格分隔形式 */
function referencesHeader(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) {
    const items = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
    return items.length > 0 ? items.join(' ') : null
  }
  return null
}

function parseSignatureHeader(raw: string): {
  timestamp: string
  signatures: string[]
} | null {
  let timestamp = ''
  const signatures: string[] = []

  for (const segment of raw.split(',')) {
    const index = segment.indexOf('=')
    if (index < 0) continue
    const key = segment.slice(0, index).trim().toLowerCase()
    const value = segment.slice(index + 1).trim()
    if (!value) continue
    if (key === 't') timestamp = value
    else if (key === 'v1') signatures.push(value)
  }

  if (!timestamp || signatures.length === 0) return null
  return { timestamp, signatures }
}

/**
 * Groundmail 采用 Stripe 风格签名（不是 Svix）：头 `Groundmail-Signature: t=...,v1=...`，
 * 签名串 `\`${t}.${rawBody}\``，HMAC-SHA256 十六进制。
 * 密钥是 `whsec_` 前缀，但要求按原文当 key；同时保留去前缀的候选，避免实现差异导致全 401。
 */
function signatureKeys(secret: string): Buffer[] {
  const keys = [Buffer.from(secret, 'utf8')]
  const stripped = secret.replace(/^whsec_/, '')
  if (stripped && stripped !== secret) keys.push(Buffer.from(stripped, 'utf8'))
  return keys
}

function verifySignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
) {
  if (!header) {
    throw new ProviderError('Groundmail 缺少 Groundmail-Signature 头', {
      code: 'invalid_signature',
    })
  }

  const parsed = parseSignatureHeader(header)
  if (!parsed) {
    throw new ProviderError('Groundmail 签名头格式不合法', {
      code: 'invalid_signature',
    })
  }

  const sentAt = Number(parsed.timestamp)
  if (!Number.isFinite(sentAt)) {
    throw new ProviderError('Groundmail 签名时间戳不合法', {
      code: 'invalid_signature',
    })
  }
  if (
    Math.abs(Math.floor(Date.now() / 1000) - sentAt) >
    SIGNATURE_TOLERANCE_SECONDS
  ) {
    throw new ProviderError('Groundmail 签名已过期', {
      code: 'invalid_signature',
    })
  }

  const signed = `${parsed.timestamp}.${rawBody}`
  const matched = signatureKeys(secret).some((key) => {
    const expected = Buffer.from(
      createHmac('sha256', key).update(signed).digest('hex'),
    )
    return parsed.signatures.some((candidate) => {
      const provided = Buffer.from(candidate)
      return (
        provided.length === expected.length &&
        timingSafeEqual(provided, expected)
      )
    })
  })

  if (!matched) {
    throw new ProviderError('Groundmail 签名校验失败', {
      code: 'invalid_signature',
    })
  }
}

/**
 * Groundmail 没有 svix-id 这类投递 ID，用 `类型:主体 ID` 作为去重键；
 * 无主体 ID 的事件（联系人退订等）退回原始载荷哈希，重投时不会重复处理。
 */
function eventIdFor(
  type: string,
  data: Record<string, unknown>,
  rawBody: string,
): string {
  const subjectId =
    asString(data.email_id) ??
    asString(data.id) ??
    asString(data.suppression_id) ??
    asString(data.category_opt_out_id)
  if (subjectId) return `${type}:${subjectId}`
  return `${type}:${createHash('sha256').update(rawBody).digest('hex').slice(0, 32)}`
}

export const groundmailProvider: MailProvider = {
  kind: 'groundmail',
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
    // from 用对象形式，避开「名称含特殊字符必须加引号」的坑；收件人只发裸地址
    const body: Record<string, unknown> = {
      from: message.from.name
        ? { email: message.from.address, name: message.from.name }
        : message.from.address,
      to: message.to.map((item) => item.address),
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers,
      attachments: message.attachments?.map((item) => ({
        name: item.filename,
        data: item.content,
        content_type: item.contentType,
        content_id: item.contentId ? wrapContentId(item.contentId) : undefined,
      })),
    }

    if (message.cc?.length) {
      body.cc = message.cc.map((item) => item.address)
    }
    if (message.bcc?.length) {
      body.bcc = message.bcc.map((item) => item.address)
    }
    if (message.replyTo?.length) {
      body.reply_to = message.replyTo.map((item) => item.address)
    }

    const data = await request<GroundmailSendResult>(config, '/emails', {
      method: 'POST',
      headers: { 'Idempotency-Key': message.idempotencyKey },
      body,
    })

    if (!data.id) {
      throw new ProviderError('Groundmail 未返回邮件 ID', {
        code: 'send_rejected',
      })
    }

    return {
      providerMessageId: data.id,
      status: data.status === 'scheduled' ? 'queued' : 'sent',
    }
  },

  async getInbound(
    providerMessageId: string,
    config: ProviderRuntimeConfig,
  ): Promise<InboundContent> {
    const payload = await request<{
      received_email?: GroundmailReceivedEmail
    }>(config, `/received-emails/${encodeURIComponent(providerMessageId)}`, {
      timeoutMs: INBOUND_TIMEOUT_MS,
    })

    const data = payload.received_email
    if (!data) {
      throw new ProviderError('Groundmail 未返回入站邮件内容', {
        code: 'not_found',
        httpStatus: 404,
      })
    }

    // Groundmail 不暴露原始头，只给结构化字段；补回线程归并需要的三项
    const headers: Record<string, string> = {}
    const headerPairs: [string, string | null][] = [
      ['message-id', asString(data.message_id)],
      ['in-reply-to', asString(data.in_reply_to)],
      ['references', referencesHeader(data.references)],
      ['subject', asString(data.subject)],
    ]
    for (const [key, value] of headerPairs) {
      if (value) headers[key] = value
    }

    return {
      html: data.html_body ?? undefined,
      text: data.text_body ?? undefined,
      headers,
      attachments: mapInboundAttachments(data.attachments),
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

    verifySignature(
      rawBody,
      headers['groundmail-signature'],
      config.webhookSecret,
    )

    let payload: Record<string, unknown>
    try {
      payload = asRecord(JSON.parse(rawBody))
    } catch {
      throw new ProviderError('Groundmail Webhook 载荷不是合法 JSON', {
        code: 'invalid_payload',
      })
    }

    const type = asString(payload.type) ?? 'unknown'
    const data = asRecord(payload.data)

    // 事件名与 data.email_id 跟 Resend 一致，归一化逻辑直接复用
    return normalizeEmailWebhook({
      type,
      eventId: eventIdFor(type, data, rawBody),
      createdAt: asString(payload.created_at) ?? undefined,
      data: payload.data,
    })
  },

  async createDomain(hostname, config) {
    // 不自动开入站：入站要改 MX，会接管整个名字的邮件，交给管理员显式确认
    const data = await request<GroundmailDomainResponse>(config, '/domains', {
      method: 'POST',
      body: { name: hostname },
    })

    const domain = data.domain
    if (!domain?.id) {
      throw new ProviderError('Groundmail 未返回域名 ID', {
        code: 'domain_create_failed',
      })
    }

    return {
      providerDomainId: domain.id,
      status: mapStatus(domain.status),
      records: mapRecords(data.records, data.inbound_records),
    }
  },

  async getDomain(providerDomainId, config) {
    const data = await request<GroundmailDomainResponse>(
      config,
      `/domains/${encodeURIComponent(providerDomainId)}`,
    )
    return {
      status: mapStatus(data.domain?.status),
      records: mapRecords(data.records, data.inbound_records),
    }
  },

  async verifyDomain(providerDomainId, config) {
    try {
      const result = await request<{ verified?: boolean }>(
        config,
        `/domains/${encodeURIComponent(providerDomainId)}`,
        { method: 'POST', body: { action: 'verify' } },
      )
      if (result.verified === false) {
        throw new ProviderError(
          'Groundmail 域名验证未通过：DKIM 或 return-path 尚未生效',
          { code: 'domain_not_verified' },
        )
      }
    } catch (error) {
      // DNS 已发布但邮件服务器还没认到 DKIM/return-path 时，Groundmail 直接回 400
      if (error instanceof ProviderError && error.httpStatus === 400) {
        throw new ProviderError(
          'Groundmail 域名验证未通过：DKIM / return-path 尚未生效，等 DNS 传播后再点验证',
          { code: 'domain_not_verified' },
        )
      }
      throw error
    }
  },
}
