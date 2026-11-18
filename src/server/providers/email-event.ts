import { splitAddressList } from '#/lib/email-address'

import type {
  InboundAttachmentMeta,
  MessageStatus,
  VerifiedWebhookEvent,
} from './types'

/**
 * Resend 与 UnitPost 共用同一套 `email.*` 事件名和 `email_id` 字段，
 * 归一化逻辑放在这里，两个适配器只负责验签。
 */
const STATUS_BY_EVENT: Record<string, MessageStatus | undefined> = {
  'email.sent': 'sent',
  'email.delivery_delayed': 'sent',
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
  'email.suppressed': 'suppressed',
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function asAddressList(value: unknown): string[] {
  if (typeof value === 'string') {
    return splitAddressList(value)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .flatMap((item) => splitAddressList(item))
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

export function mapInboundAttachments(
  value: unknown,
): InboundAttachmentMeta[] | undefined {
  if (!Array.isArray(value)) return undefined

  const items = value.flatMap((raw, index) => {
    const item = asRecord(raw)
    const id =
      asString(item.id) ??
      asString(item.attachment_id) ??
      asString(item.provider_attachment_id) ??
      `att_${index}`
    // AhaSend 的路由事件直接给 base64，没有 size 字段
    const base64 = asString(item.data)
    const size =
      typeof item.size === 'number'
        ? item.size
        : base64
          ? Math.floor((base64.length * 3) / 4) -
            (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
          : 0
    return [
      {
        providerAttachmentId: id,
        filename: asString(item.filename) ?? 'attachment',
        contentType: asString(item.content_type) ?? 'application/octet-stream',
        size,
        contentId: asString(item.content_id),
      },
    ]
  })

  return items.length > 0 ? items : undefined
}

export function normalizeEmailWebhook(input: {
  type: string
  eventId: string
  createdAt?: string
  data: unknown
}): VerifiedWebhookEvent {
  const data = asRecord(input.data)

  if (input.type === 'email.received') {
    const providerMessageId = asString(data.email_id) ?? asString(data.id)
    if (!providerMessageId) {
      return {
        eventId: input.eventId,
        type: input.type,
        kind: 'ignored',
        createdAt: input.createdAt,
        data: input.data,
      }
    }

    return {
      eventId: input.eventId,
      type: input.type,
      kind: 'inbound',
      createdAt: input.createdAt,
      data: {
        providerMessageId,
        from: asString(data.from) ?? '',
        to: asAddressList(data.to),
        cc: asAddressList(data.cc),
        bcc: asAddressList(data.bcc),
        subject: asString(data.subject),
        receivedAt:
          asString(data.received_at) ?? asString(data.created_at) ?? undefined,
        attachments: mapInboundAttachments(data.attachments),
      },
    }
  }

  const status = STATUS_BY_EVENT[input.type]
  const providerMessageId = asString(data.email_id) ?? asString(data.id)

  if (!status || !providerMessageId) {
    return {
      eventId: input.eventId,
      type: input.type,
      kind: 'ignored',
      createdAt: input.createdAt,
      data: input.data,
    }
  }

  return {
    eventId: input.eventId,
    type: input.type,
    kind: 'status',
    createdAt: input.createdAt,
    data: { providerMessageId, status },
  }
}
