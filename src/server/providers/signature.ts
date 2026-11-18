import { createHmac, timingSafeEqual } from 'node:crypto'

import { ProviderError } from './types'

/** Standard Webhooks / Svix 的签名头；两家服务商字段名一致 */
export interface StandardSignatureHeaders {
  id?: string
  timestamp?: string
  signature?: string
}

/**
 * 校验 `v1,<base64>` 形式的 HMAC-SHA256 签名。
 * 签名串固定为 `${id}.${timestamp}.${rawBody}`，必须用原始请求体。
 */
export function verifyStandardSignature(params: {
  rawBody: string
  headers: StandardSignatureHeaders
  /** 允许同时尝试多个候选密钥（例如 Svix 的 base64 解码值与原文） */
  keys: Buffer[]
  label: string
  toleranceSeconds?: number
}): void {
  const { id, timestamp, signature } = params.headers

  if (!id || !timestamp || !signature) {
    throw new ProviderError(`${params.label} 缺少签名头`, {
      code: 'invalid_signature',
    })
  }

  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt)) {
    throw new ProviderError(`${params.label} 签名时间戳不合法`, {
      code: 'invalid_signature',
    })
  }

  const tolerance = params.toleranceSeconds ?? 300
  if (Math.abs(Math.floor(Date.now() / 1000) - sentAt) > tolerance) {
    throw new ProviderError(`${params.label} 签名已过期`, {
      code: 'invalid_signature',
    })
  }

  const signed = `${id}.${timestamp}.${params.rawBody}`
  const provided = signature
    .split(' ')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith('v1,') ? item.slice(3) : item))

  const matches = params.keys.some((key) => {
    const expected = createHmac('sha256', key).update(signed).digest('base64')
    const expectedBuffer = Buffer.from(expected)
    return provided.some((candidate) => {
      const candidateBuffer = Buffer.from(candidate)
      return (
        candidateBuffer.length === expectedBuffer.length &&
        timingSafeEqual(candidateBuffer, expectedBuffer)
      )
    })
  })

  if (!matches) {
    throw new ProviderError(`${params.label} 签名校验失败`, {
      code: 'invalid_signature',
    })
  }
}

/**
 * Svix 的密钥是 `whsec_<base64>`，标准实现会先 base64 解码；
 * 也有服务商直接拿原文当 key。两种都试，避免因实现差异全部 401。
 */
export function svixSignatureKeys(secret: string): Buffer[] {
  const keys = [Buffer.from(secret, 'utf8')]
  const body = secret.replace(/^whsec_/, '')
  if (body && body !== secret && /^[A-Za-z0-9+/=_-]+$/.test(body)) {
    const decoded = Buffer.from(body, 'base64')
    if (decoded.length > 0) keys.push(decoded)
  }
  return keys
}
