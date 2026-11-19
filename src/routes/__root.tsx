import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { DirectionProvider } from '@/components/foundations/direction/direction'
import { Toaster } from '@/components/base/toast/toast'
import { RouteErrorState } from '@/components/application/errors/error-state'
import { THEME_INIT_SCRIPT } from '@/components/application/theme/theme-init'
import { getPublicSiteFn } from '#/server/fns/site'
import { sessionQuery } from '#/lib/api'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

/** /public 下的默认图标套装；站点配置了 faviconUrl 时会被覆盖 */
const DEFAULT_ICON_LINKS = [
  { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
  {
    rel: 'icon',
    type: 'image/png',
    sizes: '32x32',
    href: '/favicon-32x32.png',
  },
  {
    rel: 'icon',
    type: 'image/png',
    sizes: '16x16',
    href: '/favicon-16x16.png',
  },
]

export const Route = createRootRouteWithContext<MyRouterContext>()({
  beforeLoad: async ({ context }) => {
    // 每次导航都会跑 beforeLoad（含 Link 预取）；走 query 缓存后 30s 内不再发 RPC
    const session = await context.queryClient.ensureQueryData(sessionQuery)
    return { session }
  },
  loader: async () => {
    // 站点信息直接读，失败就让错误边界暴露出来，不再静默降级成默认站点
    const site = await getPublicSiteFn()
    return { site }
  },
  head: ({ loaderData }) => {
    const faviconUrl = loaderData?.site.faviconUrl
    return {
      meta: [
        { charSet: 'utf-8' },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1',
        },
        {
          title: loaderData ? loaderData.site.siteName : 'asms2',
        },
        {
          name: 'description',
          content: loaderData
            ? loaderData.site.siteDescription
            : 'A Simple Mail Server',
        },
      ],
      links: [
        { rel: 'stylesheet', href: appCss },
        ...(faviconUrl
          ? [{ rel: 'icon', href: faviconUrl }]
          : DEFAULT_ICON_LINKS),
        {
          rel: 'apple-touch-icon',
          sizes: '180x180',
          href: '/apple-touch-icon.png',
        },
        { rel: 'manifest', href: '/site.webmanifest' },
      ],
    }
  },
  errorComponent: RouteErrorState,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        {/* 阻塞式初始化：hydration 前确定明暗，避免暗色用户看到白屏闪烁 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="bg-background-full text-text-primary antialiased">
        <DirectionProvider locale="zh-CN">
          {children}
          <Toaster position="bottom-end" />
        </DirectionProvider>
        {import.meta.env.DEV ? (
          <TanStackDevtools
            config={{ position: 'bottom-right' }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
              TanStackQueryDevtools,
            ]}
          />
        ) : null}
        <Scripts />
      </body>
    </html>
  )
}
