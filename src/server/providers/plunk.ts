import { createHash, timingSafeEqual } from 'node:crypto'

import { asAddressList, asRecord, asString } from './email-event'
import { requestJson, trimBaseUrl } from './http'
import {
  ProviderError,
  type DnsRecord,
  type InboundContent,
  type MailProvider,
  type MessageStatus,
  type OutboundMessage,
  type ProviderRuntimeConfig,
  type SendResult,
  type VerifiedWebhookEvent,
} from './types'

/**
 * Plunk（useplunk/plunk）是「事务邮件 + 联系人 + 工作流」一体的开源服务商。
 *
 * - 发件：`POST /v1/send`，`Authorization: Bearer sk_*`，`Idempotency-Key` 可选。
 * - 收件：域名加 Plunk 给的入站 MX 后，`email.received` 事件由 **工作流的 Webhook 步骤**
 *   转发出来，正文就在事件里（Plunk 不提供按 ID 拉入站正文的接口）。
 * - 域名：`POST /domains`、`GET /domains/:id/verify`、`GET /domains/project/current`。
 *
 * 官方文档：https://github.com/useplunk/plunk/tree/next/apps/wiki/content/docs
 *
 * 注意 `api.useplunk.com`（v1）已下线并返回 410，托管版现役基地址是 next-api。
 * 自建实例可在服务商配置里用 `API Base URL` 覆盖。
 */
const DEFAULT_BASE_URL = 'https://next-api.useplunk.com'

/** Plunk 的 Webhook 没有签名，只能靠一个共享密钥请求头；三种写法都接受 */
const SECRET_HEADERS = [
  'x-plunk-secret',
  'x-plunk-signature',
  'x-webhook-secret',
] as const

/** 发信事件 → 本地 message.status；open / click / 联系人 / 自定义事件一律忽略 */
const STATUS_BY_TYPE: Record<string, MessageStatus | undefined> = {
  'email.sent': 'sent',
  'email.delivery': 'delivered',
  'email.complaint': 'complained',
}

interface PlunkConfig {
  aws?: {
    sesRegion?: string
    mailFromSubdomain?: string
  } | null
}

interface PlunkDomain {
  id: string
  domain?: string
  verified?: boolean
  dkimTokens?: string[] | null
}

interface PlunkVerification {
  domain?: string
  tokens?: string[] | null
  status?: string
  verified?: boolean
}

interface PlunkSendResponse {
  success?: boolean
  data?: {
    emails?: {
      contact?: { id?: string; email?: string }
      /** 收件人被 `delivery.throttle` 拦下时为 null */
      email?: string | null
      status?: 'queued' | 'scheduled' | 'throttled'
    }[]
  }
  error?: { code?: string; message?: string }
}

function apiUrl(config: ProviderRuntimeConfig, path: string) {
  return `${trimBaseUrl(config.apiBaseUrl, DEFAULT_BASE_URL)}${path}`
}

function parsePlunkError(status: number, payload: unknown) {
  const error = asRecord(asRecord(payload).error)
  return {
    message: asString(error.message) ?? `Plunk 返回 HTTP ${status}`,
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
    label: 'Plunk',
    parseError: parsePlunkError,
  })
}

/**
 * 适配层不能 import `server/mail/*`（依赖方向），而 Plunk 的 `body` 必填、
 * 只接受 HTML，所以这里留一份最小转义实现，仅用于 html 缺失时兜底。
 */
function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br />')}</p>`)
    .join('')
  return `<div>${paragraphs}</div>`
}

/** Plunk 要求 body 里带 projectId（uuid），但实际按 API Key 定位项目；没存就传占位值 */
function projectIdFor(config: ProviderRuntimeConfig) {
  const value = config.accountId?.trim()
  if (
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    return value
  }
  return '00000000-0000-0000-0000-000000000000'
}

/**
 * DNS 记录由 Plunk 的面板拼出来（API 只回 DKIM token），这里按同一规则还原：
 * 3 条 DKIM CNAME 是发信必需；MAIL FROM 的 MX/TXT 与入站 MX 取决于实例的 SES 区域。
 */
function recordsFor(
  hostname: string,
  tokens: string[] | null | undefined,
  config?: PlunkConfig | null,
): DnsRecord[] {
  const records: DnsRecord[] = (tokens ?? []).map((token) => ({
    record: 'dkim',
    name: `${token}._domainkey.${hostname}`,
    type: 'CNAME',
    value: `${token}.dkim.amazonses.com`,
  }))

  const region = config?.aws?.sesRegion?.trim()
  if (!region) return records

  const mailFrom = config?.aws?.mailFromSubdomain?.trim() || 'plunk'
  records.push({
    record: 'mail_from_mx',
    name: `${mailFrom}.${hostname}`,
    type: 'MX',
    value: `feedback-smtp.${region}.amazonses.com`,
    priority: 10,
  })
  records.push({
    record: 'mail_from_spf',
    name: `${mailFrom}.${hostname}`,
    type: 'TXT',
    value: '"v=spf1 include:amazonses.com ~all"',
  })
  // 入站是可选项：这条 MX 会接管整个名字的来信，是否发布由管理员决定
  records.push({
    record: 'inbound_mx',
    name: hostname,
    type: 'MX',
    value: `inbound-smtp.${region}.amazonaws.com`,
    priority: 10,
  })

  return records
}

/**
 * Plunk 的事件名不会出现在载荷里（Webhook 步骤只转发触发事件的数据），
 * 只能按事件特有的字段反推。顺序很重要：退信/投诉要排在 delivered 之前。
 */
function inferEventType(event: Record<string, unknown>): string {
  if (asString(event.bouncedAt) || asString(event.bounceType)) {
    return 'email.bounce'
  }
  if (
    asString(event.complainedAt) ||
    asString(event.complaintFeedbackType) ||
    // suppressedByProvider 的投诉事件没有 complainedAt，只有 complaintSubType
    asString(event.complaintSubType)
  ) {
    return 'email.complaint'
  }
  if (asString(event.deliveredAt)) return 'email.delivery'
  if (asString(event.openedAt)) return 'email.open'
  if (asString(event.clickedAt)) return 'email.click'
  if (asString(event.sentAt)) return 'email.sent'
  if (
    Array.isArray(event.recipients) ||
    asString(event.body) ||
    asString(event.fromHeader) ||
    event.hasContent !== undefined
  ) {
    return 'email.received'
  }
  if (asString(event.reason)) return 'contact.unsubscribed'
  return 'unknown'
}

/** 去重键：优先工作流执行 ID，其次邮件/消息 ID，最后退回载荷哈希 */
function eventIdFor(
  type: string,
  payload: Record<string, unknown>,
  event: Record<string, unknown>,
  rawBody: string,
): string {
  const executionId = asString(asRecord(payload.execution).id)
  if (executionId) return `${executionId}:${type}`

  const subjectId = asString(event.emailId) ?? asString(event.messageId)
  if (subjectId) return `${type}:${subjectId}`

  return `${type}:${createHash('sha256').update(rawBody).digest('hex').slice(0, 32)}`
}

function providedSecret(headers: Record<string, string>): string | null {
  for (const name of SECRET_HEADERS) {
    const value = headers[name]?.trim()
    if (value) return value
  }

  const authorization = headers['authorization']?.trim()
  if (!authorization) return null
  const match = /^bearer\s+(.+)$/i.exec(authorization)
  return match ? match[1].trim() : null
}

/**
 * Plunk 的 Webhook 步骤只支持「自定义请求头」，没有 HMAC 签名，
 * 所以这里做的是共享密钥的常量时间比对——头里没带密钥一律 401。
 */
function verifySharedSecret(headers: Record<string, string>, secret: string) {
  const provided = providedSecret(headers)
  if (!provided) {
    throw new ProviderError(
      'Plunk Webhook 缺少密钥请求头（建议 X-Plunk-Secret）',
      { code: 'invalid_signature' },
    )
  }

  const providedBuffer = Buffer.from(provided, 'utf8')
  const expectedBuffer = Buffer.from(secret, 'utf8')
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new ProviderError('Plunk Webhook 密钥校验失败', {
      code: 'invalid_signature',
    })
  }
}

/** Plunk 的入站正文是「已净化的 HTML，或没有 HTML 时的纯文本」，只能靠首字符判断 */
function looksLikeHtml(value: string) {
  return /^\s*</.test(value)
}

function inboundContent(
  event: Record<string, unknown>,
): InboundContent | undefined {
  const body = asString(event.body)
  if (!body) return undefined

  return looksLikeHtml(body)
    ? { html: body, headers: {} }
    : { text: body, headers: {} }
}

export const plunkProvider: MailProvider = {
  kind: 'plunk',
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
    // Plunk 的 /v1/send 只有 to / reply，没有 cc / bcc；静默并进 to 会泄露密送对象
    if (message.cc?.length || message.bcc?.length) {
      throw new ProviderError(
        'Plunk 不支持抄送/密送（API 只有 to 字段），请去掉 cc/bcc 后重发',
        { code: 'unsupported_feature' },
      )
    }

    const html = message.html ?? (message.text ? textToHtml(message.text) : '')
    if (!html) {
      throw new ProviderError('Plunk 要求提供 html 或 text 正文', {
        code: 'invalid_payload',
      })
    }

    const payload = await request<PlunkSendResponse>(config, '/v1/send', {
      method: 'POST',
      // Plunk 的幂等键按项目存储，同一 key 第二次请求回 409
      headers: { 'Idempotency-Key': message.idempotencyKey },
      body: {
        from: message.from.name
          ? { email: message.from.address, name: message.from.name }
          : message.from.address,
        to: message.to.map((item) =>
          item.name ? { email: item.address, name: item.name } : item.address,
        ),
        subject: message.subject,
        body: html,
        // reply 只接受单个地址，与本站「回复到发件邮箱」的语义一致
        ...(message.replyTo?.[0] ? { reply: message.replyTo[0].address } : {}),
        ...(message.headers && Object.keys(message.headers).length > 0
          ? { headers: message.headers }
          : {}),
        ...(message.attachments?.length
          ? {
              attachments: message.attachments.map((item) => ({
                filename: item.filename,
                content: item.content,
                contentType: item.contentType ?? 'application/octet-stream',
                ...(item.contentId
                  ? {
                      contentId: item.contentId.replace(/[<>]/g, ''),
                      disposition: 'inline' as const,
                    }
                  : {}),
              })),
            }
          : {}),
      },
    })

    if (payload.success === false) {
      throw new ProviderError(
        asString(payload.error?.message) ?? 'Plunk 拒绝了本次发送',
        { code: asString(payload.error?.code) ?? 'send_rejected' },
      )
    }

    // 多收件人时 Plunk 为每人建一条邮件记录；本站只跟踪首个（与 Resend 单 ID 语义一致）
    const first = payload.data?.emails?.[0]
    if (first?.status === 'throttled' || !first?.email) {
      throw new ProviderError('Plunk 未返回邮件 ID（可能被投递节流拦下）', {
        code: 'send_rejected',
      })
    }

    return {
      providerMessageId: first.email,
      status: first.status === 'scheduled' ? 'queued' : 'sent',
    }
  },

  async getInbound(
    _providerMessageId: string,
    _config: ProviderRuntimeConfig,
  ): Promise<InboundContent> {
    // Plunk 不存原始 MIME，也没有按 ID 拉取入站正文的接口；正文只在
    // email.received 事件的 body 里，适配器已在 verifyWebhook 里一并带回。
    throw new ProviderError(
      'Plunk 不提供按 ID 拉取入站邮件的接口，正文只在 email.received 的 Webhook 里',
      { code: 'not_implemented' },
    )
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

    verifySharedSecret(headers, config.webhookSecret)

    let payload: Record<string, unknown>
    try {
      payload = asRecord(JSON.parse(rawBody))
    } catch {
      throw new ProviderError('Plunk Webhook 载荷不是合法 JSON', {
        code: 'invalid_payload',
      })
    }

    // 默认载荷是 { contact, workflow, execution, event }；
    // 若在工作流里把 body 配成 `{{event}}`，整个载荷就是事件本身
    const event = asRecord(payload.event ?? payload)
    const type = inferEventType(event)
    const eventId = eventIdFor(type, payload, event, rawBody)
    const createdAt =
      asString(event.timestamp) ??
      asString(event.sentAt) ??
      asString(event.deliveredAt) ??
      asString(event.bouncedAt) ??
      asString(event.complainedAt) ??
      undefined

    if (type === 'email.received') {
      // SES message id 是入站邮件的稳定标识，用于 message 表去重
      const providerMessageId =
        asString(event.messageId) ?? asString(event.emailId)
      if (!providerMessageId) {
        throw new ProviderError('Plunk 入站事件缺少 messageId', {
          code: 'invalid_payload',
        })
      }

      const primary = asString(event.to)
      const recipients = asAddressList(event.recipients)
      // Plunk 不区分 To/Cc/Bcc，只会给信封收件人列表；全部按 to 记录，
      // 保证「邮箱只出现在 cc 里」的邮件也能路由到本站邮箱
      const to = Array.from(
        new Set(
          [primary, ...recipients].filter((item): item is string => !!item),
        ),
      )
      if (to.length === 0) {
        throw new ProviderError('Plunk 入站事件缺少收件人', {
          code: 'invalid_payload',
        })
      }

      return {
        eventId,
        type,
        kind: 'inbound',
        createdAt,
        data: {
          providerMessageId,
          from: asString(event.from) ?? '',
          to,
          subject: asString(event.subject),
          receivedAt: createdAt,
          // Plunk 在解析阶段就丢掉入站附件，这里只能给空
          attachments: undefined,
          content: inboundContent(event),
        },
      }
    }

    if (type === 'email.bounce') {
      const providerMessageId =
        asString(event.emailId) ?? asString(event.messageId)
      if (providerMessageId) {
        // 软退信 Plunk 还会自己重试，保持「已发送」；只有永久退信才算 bounced
        const transient =
          event.transientBounce === true || event.bounceType === 'Transient'
        return {
          eventId,
          type,
          kind: 'status',
          createdAt,
          data: {
            providerMessageId,
            status: transient ? 'sent' : 'bounced',
          },
        }
      }
    }

    const status = STATUS_BY_TYPE[type]
    const providerMessageId =
      asString(event.emailId) ?? asString(event.messageId)
    if (status && providerMessageId) {
      return {
        eventId,
        type,
        kind: 'status',
        createdAt,
        data: { providerMessageId, status },
      }
    }

    return { eventId, type, kind: 'ignored', createdAt, data: event }
  },

  async createDomain(hostname, config) {
    const host = hostname.toLowerCase()

    // 先把实例配置拿到：DNS 记录里 MAIL FROM 与入站 MX 的值取决于 SES 区域
    const instance = await request<PlunkConfig>(config, '/config').catch(
      () => null,
    )

    const created = await request<PlunkDomain>(config, '/domains', {
      method: 'POST',
      body: { projectId: projectIdFor(config), domain: host },
    })

    if (!created.id) {
      throw new ProviderError('Plunk 未返回域名 ID', {
        code: 'domain_create_failed',
      })
    }

    return {
      providerDomainId: created.id,
      status: created.verified ? 'verified' : 'pending',
      records: recordsFor(created.domain ?? host, created.dkimTokens, instance),
    }
  },

  async getDomain(providerDomainId, config) {
    const [instance, domains] = await Promise.all([
      request<PlunkConfig>(config, '/config').catch(() => null),
      // 路由里的 projectId 会被忽略（按 API Key 定位项目），传 current 当占位
      request<PlunkDomain[]>(config, '/domains/project/current'),
    ])

    const found = (domains ?? []).find((item) => item.id === providerDomainId)
    if (!found) {
      throw new ProviderError('Plunk 未找到该域名', {
        code: 'not_found',
        httpStatus: 404,
      })
    }

    return {
      status: found.verified ? 'verified' : 'pending',
      records: recordsFor(found.domain ?? '', found.dkimTokens, instance),
    }
  },

  async verifyDomain(providerDomainId, config) {
    // 该接口会立刻跑一次 DNS 检查并回写 verified；失败状态由 getDomain 体现
    await request<PlunkVerification>(
      config,
      `/domains/${encodeURIComponent(providerDomainId)}/verify`,
    )
  },
}
