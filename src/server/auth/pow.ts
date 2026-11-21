import '#/server/env'

import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto'

import type { BetterAuthPlugin } from 'better-auth'

import { db } from '#/db/client'
import { powChallenge } from '#/db/schema'
import { getSiteSettings } from '#/server/settings'

/**
 * 自托管的工作量证明（Proof of Work）人机校验，协议与 ALTCHA 一致：
 *
 *   服务端出题：salt（含过期时间）+ 随机数 n → challenge = SHA-256(salt + n)，
 *              signature = HMAC(challenge)，只把 salt / challenge / signature / 上限发给浏览器；
 *   浏览器解题：从 0 枚举到上限，找到 SHA-256(salt + n) === challenge 的 n；
 *   服务端验证：签名对得上、哈希对得上、没过期、salt 没用过（落库防重放）。
 *
 * 不依赖任何第三方服务（Turnstile / reCAPTCHA 在部分地区不可用），也不需要在 CSP 里放行外部脚本。
 * 它不能区分「人」和「愿意花 CPU 的机器」，作用是抬高批量注册 / 撞库 / 邮件轰炸的成本，
 * 需要和按 IP 限流一起用。
 */

export const POW_HEADER = 'x-pow-solution'

/** 平均需要枚举一半，现代浏览器约 0.3–1.5 秒；可用环境变量调整 */
export const POW_MAX_NUMBER = Math.max(
  1_000,
  Number(process.env.POW_MAX_NUMBER) || 100_000,
)

const CHALLENGE_TTL_SECONDS = 10 * 60

/** 需要通过校验才能调用的 Better Auth 端点 */
export const POW_PROTECTED_ENDPOINTS = [
  '/sign-up/email',
  '/sign-in/email',
  '/request-password-reset',
  '/send-verification-email',
]

export interface PowChallenge {
  algorithm: 'SHA-256'
  challenge: string
  salt: string
  maxnumber: number
  signature: string
}

export interface PowSolution {
  algorithm: 'SHA-256'
  challenge: string
  salt: string
  number: number
  signature: string
}

export type PowFailure =
  | 'missing'
  | 'malformed'
  | 'bad_signature'
  | 'wrong_answer'
  | 'expired'
  | 'replayed'

function hmacKey(): Buffer {
  const signingKey = process.env.BETTER_AUTH_SECRET
  if (!signingKey) {
    throw new Error('BETTER_AUTH_SECRET 未配置，无法签发人机校验题目')
  }
  // 与会话签名用途隔离：派生一个只用于 PoW 的子密钥
  return createHmac('sha256', signingKey).update('asms2:pow:v1').digest()
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function sign(challenge: string): string {
  return createHmac('sha256', hmacKey()).update(challenge).digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

function expiresFromSalt(salt: string): number | null {
  const match = salt.match(/[?&]expires=(\d{1,12})(?:&|$)/)
  return match ? Number(match[1]) : null
}

export function createPowChallenge(
  options: { maxNumber?: number; now?: number } = {},
): PowChallenge {
  const maxnumber = options.maxNumber ?? POW_MAX_NUMBER
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000)
  const salt = `${randomBytes(12).toString('hex')}?expires=${nowSeconds + CHALLENGE_TTL_SECONDS}`
  const challenge = sha256Hex(`${salt}${randomInt(0, maxnumber + 1)}`)
  return {
    algorithm: 'SHA-256',
    challenge,
    salt,
    maxnumber,
    signature: sign(challenge),
  }
}

/** 浏览器端提交的请求头是 base64(JSON(PowSolution)) */
export function encodePowSolution(solution: PowSolution): string {
  return Buffer.from(JSON.stringify(solution), 'utf8').toString('base64')
}

function decode(header: string): PowSolution | null {
  if (header.length > 2_000) return null
  try {
    const value = JSON.parse(
      Buffer.from(header, 'base64').toString('utf8'),
    ) as Partial<PowSolution>
    if (
      value.algorithm !== 'SHA-256' ||
      typeof value.challenge !== 'string' ||
      typeof value.salt !== 'string' ||
      typeof value.signature !== 'string' ||
      typeof value.number !== 'number' ||
      !Number.isSafeInteger(value.number) ||
      value.number < 0 ||
      value.salt.length > 200 ||
      !/^[0-9a-f]{64}$/.test(value.challenge) ||
      !/^[0-9a-f]{64}$/.test(value.signature)
    ) {
      return null
    }
    return value as PowSolution
  } catch {
    return null
  }
}

/**
 * 校验并消费一份解答。成功返回 null，失败返回原因。
 * 签名与哈希都对上之后才落库，避免攻击者用垃圾请求把防重放表写满。
 */
export async function verifyPowSolution(
  header: string | null | undefined,
  options: { now?: number } = {},
): Promise<PowFailure | null> {
  if (!header) return 'missing'
  const solution = decode(header.trim())
  if (!solution) return 'malformed'

  if (!safeEqualHex(sign(solution.challenge), solution.signature)) {
    return 'bad_signature'
  }
  const answer = sha256Hex(`${solution.salt}${solution.number}`)
  if (!safeEqualHex(answer, solution.challenge)) return 'wrong_answer'

  const expires = expiresFromSalt(solution.salt)
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000)
  if (!expires || expires < nowSeconds) return 'expired'

  const inserted = await db
    .insert(powChallenge)
    .values({ salt: solution.salt, expiresAt: new Date(expires * 1000) })
    .onConflictDoNothing()
    .returning({ salt: powChallenge.salt })
  return inserted.length > 0 ? null : 'replayed'
}

const FAILURE_MESSAGE: Record<PowFailure, string> = {
  missing: '缺少人机校验，请刷新页面后重试',
  malformed: '人机校验数据无效，请刷新页面后重试',
  bad_signature: '人机校验数据无效，请刷新页面后重试',
  wrong_answer: '人机校验未通过，请刷新页面后重试',
  expired: '人机校验已过期，请重新提交',
  replayed: '人机校验已使用过，请重新提交',
}

function normalizePath(pathname: string, basePath: string) {
  let path = pathname.startsWith(basePath)
    ? pathname.slice(basePath.length)
    : pathname
  path = path.replace(/\/{2,}/g, '/')
  if (!path.startsWith('/')) path = `/${path}`
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return path
}

/**
 * Better Auth 插件：受保护端点在进入业务逻辑前校验 PoW。
 * 只在经过 HTTP handler 的请求上生效（服务端直接调用 auth.api 不受影响）。
 * 开关读站点配置（10 秒缓存），关闭后立即放行，无需重建实例。
 */
export function powCaptcha(): BetterAuthPlugin {
  return {
    id: 'asms2-pow-captcha',
    onRequest: async (request, ctx) => {
      if (request.method !== 'POST') return
      const basePath = ctx.options.basePath ?? '/api/auth'
      const path = normalizePath(new URL(request.url).pathname, basePath)
      if (!POW_PROTECTED_ENDPOINTS.includes(path)) return

      const settings = await getSiteSettings().catch(() => null)
      // 读不到配置时按开启处理（fail closed）
      if (settings && !settings.captchaEnabled) return

      const failure = await verifyPowSolution(request.headers.get(POW_HEADER))
      if (!failure) return

      return {
        response: new Response(
          JSON.stringify({
            code: `POW_${failure.toUpperCase()}`,
            message: FAILURE_MESSAGE[failure],
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      }
    },
  }
}
