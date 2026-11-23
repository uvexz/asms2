import { randomUUID } from 'node:crypto'

import { definePlugin } from 'nitro'

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/
const SKIP_PREFIXES = ['/assets/', '/@', '/__']
const STATIC_FILE_RE =
  /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|webmanifest|txt|xml|ts|tsx)$/i

// Nitro 的 hook 类型只暴露 HTTPEvent.req；运行时实际是带 url/res 的 H3Event
type RuntimeEvent = {
  url: URL
  res: { headers: Headers }
}

const requestIds = new WeakMap<object, { id: string; startedAt: number }>()

/** 只记录超过该阈值（毫秒）的成功请求，避免轮询把日志刷满 */
const SLOW_REQUEST_MS = 1_000

/**
 * 全站安全响应头。只放不影响脚本加载的部分：
 *   - frame-ancestors / X-Frame-Options：禁止被他站嵌套（防点击劫持）；
 *     邮件正文是 srcdoc iframe，不受影响；
 *   - 页面的完整 nonce 版 CSP 由 src/server/security/csp.ts 在 SSR 时下发，
 *     这里只给没有 CSP 的响应（API、静态资源、report-only 模式下的页面）兜底。
 * HSTS 由 TLS 终结的 Nginx 下发，见 docs/deployment.md。
 */
const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
}

function requestIdFor(headers: Headers) {
  const incoming = headers.get('x-request-id')?.trim()
  return incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID()
}

function asRuntimeEvent(event: unknown): RuntimeEvent {
  return event as RuntimeEvent
}

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const h3 = asRuntimeEvent(event)
    const path = h3.url.pathname
    if (
      SKIP_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
      STATIC_FILE_RE.test(path)
    ) {
      return
    }

    const id = requestIdFor(event.req.headers)
    h3.res.headers.set('x-request-id', id)
    requestIds.set(event, { id, startedAt: performance.now() })
  })

  nitroApp.hooks.hook('response', (res, event) => {
    try {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        // 路由自己设置过的头（例如更严格的 CSP）优先
        if (!res.headers.has(name)) res.headers.set(name, value)
      }
      // API 响应(尤其 401/400)也绝不能进入共享缓存;routeRules 对
      // 直接返回 Response 的分支不一定生效,这里统一兜底。
      if (
        asRuntimeEvent(event).url.pathname.startsWith('/api/') &&
        !res.headers.has('cache-control')
      ) {
        res.headers.set('cache-control', 'private, no-store')
      }
    } catch {
      // 响应头不可变（已发送）时忽略
    }

    const state = requestIds.get(event)
    if (!state) return
    requestIds.delete(event)

    // 返回 Response 对象的路由（如 /api/v1/*）不会合并 event.res.headers
    try {
      res.headers.set('x-request-id', state.id)
    } catch {
      // 响应头已发送时忽略，日志中的 reqId 仍可用于排查
    }

    const durationMs = Math.round(performance.now() - state.startedAt)
    const line = JSON.stringify({
      type: 'request',
      reqId: state.id,
      method: event.req.method,
      path: asRuntimeEvent(event).url.pathname,
      status: res.status,
      durationMs: durationMs,
    })

    // 轮询请求（20s/60s）会随打开的标签线性放大日志量：
    // 成功请求只记录慢请求，4xx/5xx 全量记录
    if (res.status >= 500) console.error(line)
    else if (res.status >= 400) console.warn(line)
    else if (durationMs >= SLOW_REQUEST_MS) console.log(line)
  })
})
