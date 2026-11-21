import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { asRecord, asString, mapInboundAttachments } from './email-event'
import { requestJson, trimBaseUrl } from './http'
import { ProviderError } from './types'
import type {
  DnsRecord,
  InboundContent,
  MailProvider,
  MessageStatus,
  OutboundMessage,
  ProviderRuntimeConfig,
  SendResult,
  VerifiedWebhookEvent,
} from './types'

/**
 * Mailtrap 有三套基地址：
 * - 发信：https://send.api.mailtrap.io/api/send
 * - 收件 / 域名：https://mailtrap.io/api/*
 * 所以 config.apiBaseUrl 只覆盖「管理侧」（收件与域名），发信地址固定，
 * 避免把 /api/send 拼到 mailtrap.io 上。
 */
const DEFAULT_BASE_URL = 'https://mailtrap.io'
const SEND_BASE_URL = 'https://send.api.mailtrap.io'
/** 取件会把正文与附件元数据一起返回，放宽超时 */
const INBOUND_TIMEOUT_MS = 30_000

const INBOUND_EVENT = 'inbound.message_received'

/** 发信 Webhook 事件 → 本地 message.status；open / click / unsubscribe 一律忽略 */
const STATUS_BY_EVENT: Record<string, MessageStatus | undefined> = {
  delivery: 'delivered',
  bounce: 'bounced',
  // 软退信 Mailtrap 还会自己重试，先保持「已发送」
  'soft bounce': 'sent',
  spam: 'complained',
  suspension: 'failed',
  reject: 'failed',
}

/** 这些合规状态明确不可发信，直接标 failed，Admin 一眼能看出不是 DNS 问题 */
const BLOCKED_COMPLIANCE = new Set([
  'non_compliant',
  'suspended',
  'demo_exhausted',
])

interface MailtrapDnsRecord {
  key?: string
  name: string
  type: string
  value: string
  status?: string
}

interface MailtrapDomain {
  id?: number | string
  domain_name?: string
  dns_verified?: boolean
  compliance_status?: string | null
  inbound_enabled?: boolean
  inbound_verified?: boolean
  dns_records?: MailtrapDnsRecord[] | null
}

interface MailtrapSendResult {
  success?: boolean
  message_ids?: string[]
  errors?: unknown
}

interface MailtrapMessage {
  id: string
  from?: string | null
  to?: string[]
  cc?: string[]
  bcc?: string[]
  reply_to?: string | null
  subject?: string | null
  rfc_message_id?: string | null
  in_reply_to?: string | null
  references?: string[]
  headers?: Record<string, string> | null
  received_at?: string
  html_body?: string | null
  text_body?: string | null
  attachments?:
    | {
        attachment_id?: string
        filename?: string | null
        content_type?: string | null
        content_id?: string | null
        size?: number | null
      }[]
    | null
}

function baseUrl(config: ProviderRuntimeConfig) {
  return trimBaseUrl(config.apiBaseUrl, DEFAULT_BASE_URL)
}

/** account 接口有两种错误体：`{error}` 与 `{errors}`（字符串或字段映射） */
function errorMessageFrom(payload: unknown): string | null {
  const record = asRecord(payload)
  const direct = asString(record.error)
  if (direct) return direct

  const errors = record.errors
  if (typeof errors === 'string' && errors.trim()) return errors
  if (Array.isArray(errors)) {
    const items = errors.filter(
      (item): item is string => typeof item === 'string',
    )
    if (items.length > 0) return items.join('；')
  }
  if (errors && typeof errors === 'object') {
    const items = Object.values(errors as Record<string, unknown>)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter((value): value is string => typeof value === 'string')
    if (items.length > 0) return items.join('；')
  }
  return null
}

function parseMailtrapError(status: number, payload: unknown) {
  return {
    message: errorMessageFrom(payload) ?? `Mailtrap 返回 HTTP ${status}`,
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
    timeoutMs?: number
  } = {},
) {
  return requestJson<T>({
    url: `${baseUrl(config)}${path}`,
    method: init.method,
    body: init.body,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'User-Agent': 'asms2/1.0',
      ...init.headers,
    },
    label: 'Mailtrap',
    timeoutMs: init.timeoutMs,
    parseError: parseMailtrapError,
  })
}

function mapDomainStatus(domain: MailtrapDomain): string {
  const compliance = domain.compliance_status ?? ''
  if (BLOCKED_COMPLIANCE.has(compliance)) return 'failed'
  // 合规审核通过（或老账号没有该字段）且 DNS 已验证，才算可发信
  if (
    domain.dns_verified &&
    (compliance === '' || compliance === 'compliant')
  ) {
    return 'verified'
  }
  return 'pending'
}

function mapRecords(
  records: MailtrapDnsRecord[] | null | undefined,
): DnsRecord[] {
  return (records ?? []).map((item) => ({
    // key 是 spf / dkim1 / dkim2 / dmarc / inbound_mx，直接当记录标签
    record: item.key,
    name: item.name,
    type: item.type,
    value: item.value,
    status: item.status,
  }))
}

function addressObject(address: { address: string; name?: string }) {
  return address.name
    ? { email: address.address, name: address.name }
    : { email: address.address }
}

/**
 * 入站消息 ID 编码成 `inboxId:messageId`：
 * Mailtrap 的取件接口必须带 inbox_id，而 Webhook 与库里只保留一个字符串。
 * 发信返回的是 UUID（不含冒号），不会和入站混淆。
 */
function inboundMessageId(inboxId: string, messageId: string) {
  return `${inboxId}:${messageId}`
}

function splitInboundMessageId(value: string) {
  const index = value.indexOf(':')
  if (index <= 0 || index === value.length - 1) return null
  return {
    inboxId: value.slice(0, index),
    messageId: value.slice(index + 1),
  }
}

function idString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return asString(value)
}

/**
 * 发信事件的 timestamp 是秒，入站事件是毫秒（等于 received_at）。
 * 用 1e12 分界：秒级时间戳到 2286 年才会越过这个量级。
 */
function isoFromTimestamp(value: unknown): string | undefined {
  const parsed =
    typeof value === 'number' ? value : Number(asString(value) ?? Number.NaN)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  const ms = parsed > 1e12 ? parsed : parsed * 1000
  return new Date(ms).toISOString()
}

/** `Mailtrap-Signature` = HMAC-SHA256(原始请求体) 的小写十六进制，密钥按原文使用 */
function verifySignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
) {
  const provided = header?.trim().toLowerCase()
  if (!provided || !/^[0-9a-f]{64}$/.test(provided)) {
    throw new ProviderError('Mailtrap 缺少或格式错误的 Mailtrap-Signature 头', {
      code: 'invalid_signature',
    })
  }

  const expected = createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex')

  const providedBuffer = Buffer.from(provided, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new ProviderError('Mailtrap 签名校验失败', {
      code: 'invalid_signature',
    })
  }
}

/** 支持 JSON 批量体，以及设置成 JSON Lines 时的逐行事件 */
function parseEventList(rawBody: string): unknown[] {
  try {
    const payload = asRecord(JSON.parse(rawBody))
    if (Array.isArray(payload.events)) return payload.events
    // 兜底：单事件对象也接受
    return typeof payload.event === 'string' ? [payload] : []
  } catch {
    return rawBody
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as unknown]
        } catch {
          return []
        }
      })
  }
}

function normalizeEvent(
  raw: unknown,
  index: number,
  fallbackId: string,
): VerifiedWebhookEvent {
  const event = asRecord(raw)
  const type = asString(event.event) ?? 'unknown'
  const createdAt = isoFromTimestamp(event.timestamp)
  const eventId = asString(event.event_id) ?? `${fallbackId}:${index}`

  const inboxId = idString(event.inbox_id)
  const messageId = idString(event.message_id)

  if (type === INBOUND_EVENT) {
    if (!inboxId || !messageId) {
      return { eventId, type, kind: 'ignored', createdAt, data: event }
    }

    return {
      eventId,
      type,
      kind: 'inbound',
      createdAt,
      data: {
        providerMessageId: inboundMessageId(inboxId, messageId),
        from: asString(event.from) ?? '',
        // 事件里没有收件人，ingestInbound 会用 getInbound 回查补全
        to: [],
        receivedAt: createdAt,
      },
    }
  }

  const status = STATUS_BY_EVENT[type]
  if (status && messageId) {
    return {
      eventId,
      type,
      kind: 'status',
      createdAt,
      data: { providerMessageId: messageId, status },
    }
  }

  return { eventId, type, kind: 'ignored', createdAt, data: event }
}

export const mailtrapProvider: MailProvider = {
  kind: 'mailtrap',
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
    if (!message.html && !message.text) {
      throw new ProviderError('Mailtrap 要求 html 与 text 至少填写一项', {
        code: 'invalid_payload',
      })
    }

    const body: Record<string, unknown> = {
      from: addressObject(message.from),
      to: message.to.map(addressObject),
      subject: message.subject,
      ...(message.html ? { html: message.html } : {}),
      ...(message.text ? { text: message.text } : {}),
      ...(message.cc?.length ? { cc: message.cc.map(addressObject) } : {}),
      ...(message.bcc?.length ? { bcc: message.bcc.map(addressObject) } : {}),
      ...(message.replyTo?.[0]
        ? { reply_to: addressObject(message.replyTo[0]) }
        : {}),
      ...(message.headers && Object.keys(message.headers).length > 0
        ? { headers: message.headers }
        : {}),
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((item) => ({
              content: item.content,
              filename: item.filename,
              type: item.contentType ?? 'application/octet-stream',
              disposition: item.contentId ? 'inline' : 'attachment',
              ...(item.contentId ? { content_id: item.contentId } : {}),
            })),
          }
        : {}),
    }

    const data = await requestJson<MailtrapSendResult>({
      url: `${SEND_BASE_URL}/api/send`,
      method: 'POST',
      body,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'User-Agent': 'asms2/1.0',
      },
      label: 'Mailtrap',
      // 发信接口是 { success, errors[] }，与账号接口不同
      parseError: (status, payload) => ({
        message: errorMessageFrom(payload) ?? `Mailtrap 返回 HTTP ${status}`,
        code: `http_${status}`,
      }),
    })

    // 多收件人时 Mailtrap 每个收件人一个 ID，这里只跟踪首个（与 Resend 单 ID 语义一致）
    const providerMessageId = data.message_ids?.[0]
    if (data.success === false || !providerMessageId) {
      throw new ProviderError(
        errorMessageFrom(data) ?? 'Mailtrap 未返回消息 ID',
        { code: 'send_rejected' },
      )
    }

    return { providerMessageId, status: 'sent' }
  },

  async getInbound(
    providerMessageId: string,
    config: ProviderRuntimeConfig,
  ): Promise<InboundContent> {
    const parsed = splitInboundMessageId(providerMessageId)
    if (!parsed) {
      throw new ProviderError(
        'Mailtrap 入站消息 ID 缺少 inbox 前缀，无法取件',
        { code: 'invalid_message_id' },
      )
    }

    const data = await request<MailtrapMessage>(
      config,
      `/api/inbound/inboxes/${encodeURIComponent(parsed.inboxId)}/messages/${encodeURIComponent(parsed.messageId)}`,
      { timeoutMs: INBOUND_TIMEOUT_MS },
    )

    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(data.headers ?? {})) {
      const text = asString(value)
      if (text) headers[key.toLowerCase()] = text
    }
    // 常用头单独成字段，补回 headers 供线程归并
    const references = Array.isArray(data.references)
      ? data.references.filter(Boolean).join(' ')
      : ''
    const headerPairs: [string, string | null][] = [
      ['message-id', asString(data.rfc_message_id)],
      ['in-reply-to', asString(data.in_reply_to)],
      ['references', asString(references)],
      ['reply-to', asString(data.reply_to)],
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
      to: Array.isArray(data.to) ? data.to : [],
      from: asString(data.from) ?? undefined,
      subject: asString(data.subject),
      receivedAt: asString(data.received_at) ?? undefined,
    }
  },

  verifyWebhook(
    rawBody: string,
    headers: Record<string, string>,
    config: ProviderRuntimeConfig,
  ): VerifiedWebhookEvent[] {
    if (!config.webhookSecret) {
      throw new ProviderError('未配置 Webhook 签名密钥', {
        code: 'webhook_secret_missing',
      })
    }

    verifySignature(
      rawBody,
      headers['mailtrap-signature'],
      config.webhookSecret,
    )

    const events = parseEventList(rawBody)
    if (events.length === 0) {
      throw new ProviderError('Mailtrap Webhook 载荷里没有事件', {
        code: 'invalid_payload',
      })
    }

    // 缺 event_id 时用「请求体哈希:序号」兜底；固定前缀会让后续批次与首批撞键被当成重复丢弃
    const fallbackId = `mailtrap:${createHash('sha256').update(rawBody).digest('hex').slice(0, 32)}`
    return events.map((event, index) =>
      normalizeEvent(event, index, fallbackId),
    )
  },

  async listDomains(config) {
    const data = await request<{ data?: MailtrapDomain[] }>(
      config,
      '/api/domains',
    )

    return (data.data ?? []).flatMap((item) => {
      const id = idString(item.id)
      const hostname = asString(item.domain_name)?.trim()
      if (!id || !hostname) return []
      return [
        {
          providerDomainId: id,
          hostname,
          status: mapDomainStatus(item),
        },
      ]
    })
  },

  async createDomain(hostname, config) {
    // 不自动开入站：入站要改 MX，会接管整个域名的邮件，交给管理员显式确认
    const data = await request<MailtrapDomain>(config, '/api/domains', {
      method: 'POST',
      body: { domain: { domain_name: hostname } },
    })

    if (!data.id) {
      throw new ProviderError('Mailtrap 未返回域名 ID', {
        code: 'domain_create_failed',
      })
    }

    return {
      providerDomainId: String(data.id),
      status: mapDomainStatus(data),
      records: mapRecords(data.dns_records),
    }
  },

  async getDomain(providerDomainId, config) {
    const data = await request<MailtrapDomain>(
      config,
      `/api/domains/${encodeURIComponent(providerDomainId)}`,
    )
    return {
      status: mapDomainStatus(data),
      records: mapRecords(data.dns_records),
    }
  },

  async verifyDomain(providerDomainId, config) {
    // Mailtrap 没有「立即验证」接口：GET 会重新跑一次 DNS 检查并回写记录状态。
    // 这里不抛错，让 adminVerifyDomainFn 继续拉状态，管理员能看到哪条记录没过。
    await request<MailtrapDomain>(
      config,
      `/api/domains/${encodeURIComponent(providerDomainId)}`,
    )
  },
}
