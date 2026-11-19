export type ProviderKind =
  | 'resend'
  | 'unitpost'
  | 'ahasend'
  | 'groundmail'
  | 'mailtrap'
  | 'plunk'
  | 'reloop'
  | 'custom'

export interface ProviderCapabilities {
  send: boolean
  receive: boolean
  domainApi: boolean
  webhook: boolean
}

export interface EmailAddress {
  address: string
  name?: string
}

export interface OutboundAttachment {
  filename: string
  /** base64（不含 data: 前缀） */
  content: string
  contentType?: string
  contentId?: string
}

export interface OutboundMessage {
  from: EmailAddress
  to: EmailAddress[]
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  replyTo?: EmailAddress[]
  subject: string
  html?: string
  text?: string
  headers?: Record<string, string>
  attachments?: OutboundAttachment[]
  idempotencyKey: string
}

export interface SendResult {
  providerMessageId: string
  status: 'sent' | 'queued'
}

export interface InboundAttachmentMeta {
  providerAttachmentId: string
  filename: string
  contentType: string
  size: number
  contentId?: string | null
}

export interface InboundEnvelope {
  providerMessageId: string
  from: EmailAddress
  to: EmailAddress[]
  cc: EmailAddress[]
  bcc: EmailAddress[]
  subject: string
  receivedAt: Date
  attachments: InboundAttachmentMeta[]
  headers?: Record<string, string>
}

export interface InboundContent {
  html?: string
  text?: string
  /** 归一化后的邮件头（小写 key）；服务商没给就留空 */
  headers?: Record<string, string>
  attachments?: InboundAttachmentMeta[]
  /**
   * 回查结果里的路由信息。Mailtrap 的 Webhook 只带 inbox_id / message_id，
   * 拿不到收件人，只能先拉正文再用这里的 to 路由。
   */
  to?: string[]
  from?: string
  subject?: string | null
  receivedAt?: string
}

export interface DnsRecord {
  record?: string
  name: string
  type: string
  value: string
  ttl?: string
  priority?: number
  status?: string
}

/** 服务商账号里已有的域名，用于管理员保存 API Key 后提示导入 */
export interface ProviderDomainSummary {
  providerDomainId: string
  hostname: string
  status: string
}

export interface ProviderRuntimeConfig {
  apiKey: string
  apiBaseUrl?: string | null
  webhookSecret?: string | null
  /** 服务商侧账号 ID：AhaSend 的 API 路径必须带 account_id */
  accountId?: string | null
}

/** 出站邮件状态，取值与 message.status 对齐 */
export type MessageStatus =
  'sent' | 'delivered' | 'bounced' | 'complained' | 'failed' | 'suppressed'

/**
 * Webhook 收到的入站邮件。适配器负责把各服务商的字段归一到这里，
 * 业务层不再依赖 email_id / recipients 这类服务商私有字段名。
 */
export interface InboundEventData {
  providerMessageId: string
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject?: string | null
  receivedAt?: string
  attachments?: InboundAttachmentMeta[]
  /**
   * 服务商在 Webhook 里已带正文时（如 AhaSend message.routing），
   * 直接用它，省掉一次 getInbound 调用。
   */
  content?: InboundContent
}

export interface StatusEventData {
  providerMessageId: string
  status: MessageStatus
}

/**
 * 归一化后的 Webhook 事件：
 * - inbound：入站邮件，交给 ingestInbound
 * - status：出站投递状态，回写 message.status
 * - ignored：与本站无关的事件（打开/点击/联系人等）
 */
export type VerifiedWebhookEvent =
  | {
      eventId: string
      type: string
      kind: 'inbound'
      createdAt?: string
      data: InboundEventData
    }
  | {
      eventId: string
      type: string
      kind: 'status'
      createdAt?: string
      data: StatusEventData
    }
  | {
      eventId: string
      type: string
      kind: 'ignored'
      createdAt?: string
      data: unknown
    }

/** 统一错误：retryable 决定 Webhook 是否返回 5xx、发件是否允许重试 */
export class ProviderError extends Error {
  code: string
  retryable: boolean
  httpStatus?: number

  constructor(
    message: string,
    options: { code?: string; retryable?: boolean; httpStatus?: number } = {},
  ) {
    super(message)
    this.name = 'ProviderError'
    this.code = options.code ?? 'provider_error'
    this.retryable = options.retryable ?? false
    this.httpStatus = options.httpStatus
  }
}

export interface MailProvider {
  kind: ProviderKind
  capabilities: ProviderCapabilities

  send(
    message: OutboundMessage,
    config: ProviderRuntimeConfig,
  ): Promise<SendResult>

  getInbound(
    providerMessageId: string,
    config: ProviderRuntimeConfig,
  ): Promise<InboundContent>

  /**
   * 验签并归一化 Webhook。大多数服务商一次推一个事件，返回单个对象；
   * Mailtrap 这类批量推送（`events[]`）返回数组，由 processWebhook 逐个去重处理。
   */
  verifyWebhook(
    rawBody: string,
    headers: Record<string, string>,
    config: ProviderRuntimeConfig,
  ): VerifiedWebhookEvent | VerifiedWebhookEvent[]

  /** 列出账号下已有的域名；未实现时后台不会提示导入 */
  listDomains?(config: ProviderRuntimeConfig): Promise<ProviderDomainSummary[]>

  createDomain?(
    hostname: string,
    config: ProviderRuntimeConfig,
  ): Promise<{
    providerDomainId: string
    records: DnsRecord[]
    status: string
  }>

  getDomain?(
    providerDomainId: string,
    config: ProviderRuntimeConfig,
  ): Promise<{ status: string; records: DnsRecord[] }>

  verifyDomain?(
    providerDomainId: string,
    config: ProviderRuntimeConfig,
  ): Promise<void>
}
