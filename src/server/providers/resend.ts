import { Resend } from 'resend'

import { formatAddress } from '#/lib/email-address'

import { normalizeEmailWebhook } from './email-event'
import {
  ProviderError,
  type DnsRecord,
  type InboundContent,
  type MailProvider,
  type OutboundMessage,
  type ProviderDomainSummary,
  type ProviderRuntimeConfig,
  type SendResult,
  type VerifiedWebhookEvent,
} from './types'

interface ResendErrorShape {
  message?: string
  name?: string
  statusCode?: number
}

interface ResendResponse<T> {
  data: T | null
  error: ResendErrorShape | null
}

function toProviderError(error: ResendErrorShape | null): ProviderError {
  const status = error?.statusCode ?? 500
  return new ProviderError(error?.message ?? 'Resend 请求失败', {
    code: error?.name ?? 'provider_error',
    httpStatus: status,
    retryable: status === 429 || status >= 500,
  })
}

function unwrap<T>(response: ResendResponse<T>): T {
  if (response.error || !response.data) throw toProviderError(response.error)
  return response.data
}

function createClient(config: ProviderRuntimeConfig) {
  // apiBaseUrl 让「兼容 Resend 协议的自定义服务」也能复用同一适配器
  const baseUrl = config.apiBaseUrl?.trim()
  return new Resend(config.apiKey, baseUrl ? { baseUrl } : undefined)
}

function mapStatus(status: string): string {
  if (status === 'verified') return 'verified'
  if (status === 'failed' || status === 'temporary_failure') return 'failed'
  return 'pending'
}

function mapRecords(
  records:
    | {
        record?: string
        name: string
        type: string
        value: string
        ttl?: string
        priority?: number
        status?: string
      }[]
    | undefined,
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

export const resendProvider: MailProvider = {
  kind: 'resend',
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
    const resend = createClient(config)

    const { data, error } = (await resend.emails.send(
      {
        from: formatAddress(message.from),
        to: message.to.map((item) => item.address),
        cc: message.cc?.map((item) => item.address),
        bcc: message.bcc?.map((item) => item.address),
        replyTo: message.replyTo?.map((item) => item.address),
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
        attachments: message.attachments?.map((item) => ({
          filename: item.filename,
          content: item.content,
          contentType: item.contentType,
          contentId: item.contentId,
        })),
      } as never,
      { idempotencyKey: message.idempotencyKey },
    )) as ResendResponse<{ id: string }>

    if (error || !data) throw toProviderError(error)
    return { providerMessageId: data.id, status: 'sent' }
  },

  async getInbound(
    providerMessageId: string,
    config: ProviderRuntimeConfig,
  ): Promise<InboundContent> {
    const resend = createClient(config)
    const data = unwrap(
      (await resend.emails.receiving.get(providerMessageId)) as ResendResponse<{
        html: string | null
        text: string | null
        headers: Record<string, string> | null
        attachments:
          | {
              id: string
              filename: string | null
              size: number
              content_type: string
              content_id: string | null
            }[]
          | null
      }>,
    )

    return {
      html: data.html ?? undefined,
      text: data.text ?? undefined,
      headers: data.headers ?? {},
      attachments: (data.attachments ?? []).map((item) => ({
        providerAttachmentId: item.id,
        filename: item.filename ?? 'attachment',
        contentType: item.content_type,
        size: item.size,
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

    const id = headers['svix-id'] ?? headers['webhook-id']
    const timestamp = headers['svix-timestamp'] ?? headers['webhook-timestamp']
    const signature = headers['svix-signature'] ?? headers['webhook-signature']

    if (!id || !timestamp || !signature) {
      throw new ProviderError('缺少 svix 签名头', {
        code: 'invalid_signature',
      })
    }

    const resend = new Resend(config.apiKey)
    try {
      const event = resend.webhooks.verify({
        payload: rawBody,
        headers: { id, timestamp, signature },
        webhookSecret: config.webhookSecret,
      }) as unknown as {
        type: string
        created_at?: string
        data: unknown
      }
      return normalizeEmailWebhook({
        type: event.type,
        eventId: id,
        createdAt: event.created_at,
        data: event.data,
      })
    } catch (error) {
      if (error instanceof ProviderError) throw error
      throw new ProviderError('Webhook 签名校验失败', {
        code: 'invalid_signature',
      })
    }
  },

  async listDomains(config) {
    const resend = createClient(config)
    const domains: ProviderDomainSummary[] = []
    let after: string | undefined

    for (let page = 0; page < 10; page += 1) {
      const data = unwrap(
        (await resend.domains.list({
          limit: 100,
          ...(after ? { after } : {}),
        })) as ResendResponse<{
          data: { id: string; name: string; status: string }[]
          has_more: boolean
        }>,
      )

      for (const item of data.data) {
        domains.push({
          providerDomainId: item.id,
          hostname: item.name,
          status: mapStatus(item.status),
        })
      }

      const cursor = data.data.at(-1)?.id
      if (!data.has_more || !cursor) break
      after = cursor
    }

    return domains
  },

  async createDomain(hostname, config) {
    const resend = createClient(config)
    const data = unwrap(
      (await resend.domains.create({ name: hostname })) as ResendResponse<{
        id: string
        status: string
        records?: Parameters<typeof mapRecords>[0]
      }>,
    )
    return {
      providerDomainId: data.id,
      status: mapStatus(data.status),
      records: mapRecords(data.records),
    }
  },

  async getDomain(providerDomainId, config) {
    const resend = createClient(config)
    const data = unwrap(
      (await resend.domains.get(providerDomainId)) as ResendResponse<{
        status: string
        records?: Parameters<typeof mapRecords>[0]
      }>,
    )
    return { status: mapStatus(data.status), records: mapRecords(data.records) }
  },

  async verifyDomain(providerDomainId, config) {
    const resend = createClient(config)
    unwrap(
      (await resend.domains.verify(providerDomainId)) as ResendResponse<{
        id: string
      }>,
    )
  },
}
