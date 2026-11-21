import { randomBytes } from 'node:crypto'

import { setResponseHeader } from '@tanstack/react-start/server'

/**
 * 页面级 Content-Security-Policy（nonce 方案）。
 *
 * - script-src 只认同源文件 + 本次请求的 nonce：TanStack 的 hydration / 流式脚本、
 *   主题初始化脚本都带这个 nonce；注入的内联脚本和第三方脚本一律不执行。
 * - style-src 必须保留 'unsafe-inline'：SSR 输出的 style 属性、motion 动画、
 *   邮件正文里的内联样式都依赖它（样式注入的危害远小于脚本注入）。
 *   注意不能给 style-src 加 nonce，否则浏览器会忽略 'unsafe-inline'。
 * - 邮件正文是 srcdoc iframe，会继承本策略，再叠加它自己 meta 里更严的策略。
 *
 * 模式由 CSP_MODE 控制：enforce（生产默认）/ report-only / off。开发态（Vite HMR
 * 需要内联脚本与 ws 连接）一律不下发。
 */

export type CspMode = 'enforce' | 'report-only' | 'off'

export function cspMode(): CspMode {
  if (process.env.NODE_ENV === 'development') return 'off'
  const value = process.env.CSP_MODE?.trim().toLowerCase()
  if (value === 'off' || value === 'report-only') return value
  return 'enforce'
}

export function buildCsp(nonce: string): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`],
    'style-src': ["'self'", "'unsafe-inline'"],
    // 站点 Logo / OAuth 头像 / 用户允许后的邮件远程图片
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],
    'frame-src': ["'self'"],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'media-src': ["'self'", 'data:', 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  }
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}

/**
 * 为当前 SSR 请求生成 nonce 并写入响应头。只在服务端调用（见 src/router.tsx）。
 * 返回 undefined 表示本次不启用 nonce（开发态 / CSP_MODE=off）。
 */
export function issueCspNonce(): string | undefined {
  const mode = cspMode()
  if (mode === 'off') return undefined

  const nonce = randomBytes(16).toString('base64')
  try {
    setResponseHeader(
      mode === 'enforce'
        ? 'content-security-policy'
        : 'content-security-policy-report-only',
      buildCsp(nonce),
    )
  } catch {
    // 不在请求上下文里（例如预渲染）时没有响应可写，nonce 仍可用
  }
  return nonce
}
