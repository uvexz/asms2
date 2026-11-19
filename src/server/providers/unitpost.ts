import { formatAddress } from '#/lib/email-address'

import { normalizeEmailWebhook, asRecord, asString } from './email-event'
import { requestJson, trimBaseUrl } from './http'
import { svixSignatureKeys, verifyStandardSignature } from './signature'
import { ProviderError } from './types'
import type {
  DnsRecord,
  InboundContent,
  MailProvider,
  OutboundMessage,
  ProviderDomainSummary,
  ProviderRuntimeConfig,
  SendResult,
  VerifiedWebhookEvent,
} from './types'

const DEFAULT_BASE_URL = 'https://www.unitpost.com'

interface UnitpostDnsRecord {
  record?: string
  type: string
  name: string
  value: string
  ttl?: string
  priority?: number
  status?: string
}

interface UnitpostDomain {
  id: string
  name?: string
  status: string
  records?: UnitpostDnsRecord[] | null
  /** 开启收件后才有 MX 记录，需要一并展示给管理员 */
  receiving?: {
    status?: string
    record?: UnitpostDnsRecord | null
  } | null
}

interface UnitpostSendResult {
  id: string
  status: 'queued' | 'scheduled'
}

interface UnitpostReceivedEmail {
  id: string
  html: string | null
  text: string | null
  headers?: Record<string, string> | null
  attachments?:
    | {
        id: string
        filename: string | null
        content_type: string | null
        content_id: string | null
        size?: number
      }[]
    | null
}

function apiUrl(config: ProviderRuntimeConfig, path: string) {
  return `${trimBaseUrl(config.apiBaseUrl, DEFAULT_BASE_URL)}/api/v1${path}`
}

function parseUnitpostError(status: number, payload: unknown) {
  const error = asRecord(asRecord(payload).error)
  return {
    message: asString(error.message) ?? `UnitPost 返回 HTTP ${status}`,
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
    label: 'UnitPost',
    parseError: parseUnitpostError,
  })
}

function mapStatus(status: string): string {
  // degraded 仍可发信，按 verified 处理
  if (status === 'verified' || status === 'degraded') return 'verified'
  if (status === 'failed') return 'failed'
  return 'pending'
}

function mapRecords(
  records: UnitpostDnsRecord[] | null | undefined,
): DnsRecord[] {
  return (records ?? []).map((item) => ({
    record: item.record,
    name: item.name,
    type: item.type,
    value: item.value,
    ttl: item.ttl,
    priority: item.priority,
    status: item.status,
  }))
}

/** 发信记录 + 收件 MX（开启 Receiving 后 API 单独返回） */
function mapDomainRecords(domain: UnitpostDomain): DnsRecord[] {
  const records = mapRecords(domain.records)
  const mx = domain.receiving?.record
  if (
    mx &&
    !records.some((item) => item.type === 'MX' && item.name === mx.name)
  ) {
    records.push(mapRecords([mx])[0])
  }
  return records
}

function wrapContentId(value: string) {
  return value.startsWith('<') ? value : `<${value}>`
}

export const unitpostProvider: MailProvider = {
  kind: 'unitpost',
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
    const data = await request<UnitpostSendResult>(config, '/email', {
      method: 'POST',
      headers: { 'Idempotency-Key': message.idempotencyKey },
      body: {
        from: formatAddress(message.from),
        to: message.to.map((item) => item.address),
        cc: message.cc?.length
          ? message.cc.map((item) => item.address)
          : undefined,
        bcc: message.bcc?.length
          ? message.bcc.map((item) => item.address)
          : undefined,
        reply_to: message.replyTo?.length
          ? message.replyTo.map((item) => item.address)
          : undefined,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
        attachments: message.attachments?.map((item) => ({
          filename: item.filename,
          content: item.content,
          content_type: item.contentType,
          content_id: item.contentId
            ? wrapContentId(item.contentId)
            : undefined,
        })),
      },
    })

    if (!data.id) {
      throw new ProviderError('UnitPost 未返回邮件 ID', {
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
    const data = await request<UnitpostReceivedEmail>(
      config,
      `/email/received/${encodeURIComponent(providerMessageId)}`,
    )

    return {
      html: data.html ?? undefined,
      text: data.text ?? undefined,
      headers: data.headers ?? {},
      attachments: (data.attachments ?? []).map((item) => ({
        providerAttachmentId: item.id,
        filename: item.filename ?? 'attachment',
        contentType: item.content_type ?? 'application/octet-stream',
        size: item.size ?? 0,
        contentId: item.content_id,
      })),
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

    const eventIdHeader = headers['svix-id']
    verifyStandardSignature({
      rawBody,
      headers: {
        id: eventIdHeader,
        timestamp: headers['svix-timestamp'],
        signature: headers['svix-signature'],
      },
      keys: svixSignatureKeys(config.webhookSecret),
      label: 'UnitPost',
    })

    let payload: Record<string, unknown>
    try {
      payload = asRecord(JSON.parse(rawBody))
    } catch {
      throw new ProviderError('UnitPost Webhook 载荷不是合法 JSON', {
        code: 'invalid_payload',
      })
    }

    return normalizeEmailWebhook({
      type: asString(payload.type) ?? 'unknown',
      eventId: asString(payload.event_id) ?? eventIdHeader,
      createdAt: asString(payload.created_at) ?? undefined,
      data: payload.data,
    })
  },

  async listDomains(config) {
    const domains: ProviderDomainSummary[] = []
    let after: string | undefined

    for (let page = 0; page < 10; page += 1) {
      const query = new URLSearchParams({ limit: '100' })
      if (after) query.set('after', after)

      const data = await request<{
        data?: UnitpostDomain[]
        has_more?: boolean
      }>(config, `/email/domains?${query.toString()}`)

      const items = data.data ?? []
      for (const item of items) {
        const hostname = item.name?.trim()
        if (!item.id || !hostname) continue
        domains.push({
          providerDomainId: item.id,
          hostname,
          status: mapStatus(item.status),
        })
      }

      const cursor = items.at(-1)?.id
      if (!data.has_more || !cursor) break
      after = cursor
    }

    return domains
  },

  async createDomain(hostname, config) {
    const data = await request<UnitpostDomain>(config, '/email/domains', {
      method: 'POST',
      body: { name: hostname },
    })
    return {
      providerDomainId: data.id,
      status: mapStatus(data.status),
      records: mapDomainRecords(data),
    }
  },

  async getDomain(providerDomainId, config) {
    const data = await request<UnitpostDomain>(
      config,
      `/email/domains/${encodeURIComponent(providerDomainId)}`,
    )
    return { status: mapStatus(data.status), records: mapDomainRecords(data) }
  },

  async verifyDomain(providerDomainId, config) {
    await request<UnitpostDomain>(
      config,
      `/email/domains/${encodeURIComponent(providerDomainId)}/verify`,
      { method: 'POST' },
    )
  },
}
