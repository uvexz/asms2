import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { routeTree } from './routeTree.gen'

import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'

import { ButtonLink } from '#/components/base/buttons/button'
import { issueCspNonce } from '#/server/security/csp'
import { getContext } from './integrations/tanstack-query/root-provider'

/**
 * 服务端：每次 SSR 生成一个 CSP nonce 并写进响应头；
 * 客户端：返回 undefined，hydration 时 router 会从 <meta property="csp-nonce"> 读回同一个值。
 * createIsomorphicFn 会在客户端构建里剔除服务端分支和它引用的模块。
 */
const getCspNonce = createIsomorphicFn()
  .server(() => issueCspNonce())
  .client(() => undefined)

export function getRouter() {
  const context = getContext()
  const nonce = getCspNonce()

  const router = createTanStackRouter({
    routeTree,
    context,
    ssr: nonce ? { nonce } : undefined,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: () => (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background-full px-6 text-center">
        <p className="text-title-2-medium text-text-primary">页面不存在</p>
        <p className="text-body-regular text-text-secondary">
          链接可能已失效，或你没有访问权限。
        </p>
        <ButtonLink href="/mail" className="mt-2">
          回到邮箱
        </ButtonLink>
      </div>
    ),
  })

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
