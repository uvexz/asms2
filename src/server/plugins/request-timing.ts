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
    const state = requestIds.get(event)
    if (!state) return
    requestIds.delete(event)

    // 返回 Response 对象的路由（如 /api/v1/*）不会合并 event.res.headers
    try {
      res.headers.set('x-request-id', state.id)
    } catch {
      // 响应头已发送时忽略，日志中的 reqId 仍可用于排查
    }

    const line = JSON.stringify({
      type: 'request',
      reqId: state.id,
      method: event.req.method,
      path: asRuntimeEvent(event).url.pathname,
      status: res.status,
      durationMs: Math.round(performance.now() - state.startedAt),
    })

    if (res.status >= 500) console.error(line)
    else if (res.status >= 400) console.warn(line)
    else console.log(line)
  })
})
