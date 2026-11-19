import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

import '#/server/env'

const VERSION = 'v1'
const ALGO = 'aes-256-gcm'

function getKey(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('SECRET_ENCRYPTION_KEY 未配置，无法读写服务商密钥')
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('SECRET_ENCRYPTION_KEY 必须是 32 字节的 base64')
  }
  return key
}

/** 加密任意敏感串，输出 `v1.iv.tag.ciphertext`（均为 base64url） */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, getKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptSecret(payload: string | null | undefined): string {
  if (!payload) return ''
  const [version, ivPart, tagPart, dataPart] = payload.split('.')
  if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error('密文格式不合法')
  }
  const decipher = createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(ivPart, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function last4(secret: string): string {
  return secret.slice(-4)
}

/** 常量时间比较，用于 cron / webhook 之类的共享密钥 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
