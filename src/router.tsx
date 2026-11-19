import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'

import { ButtonLink } from '@/components/base/buttons/button'
import { getContext } from './integrations/tanstack-query/root-provider'

export function getRouter() {
  const context = getContext()

  const router = createTanStackRouter({
    routeTree,
    context,
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
