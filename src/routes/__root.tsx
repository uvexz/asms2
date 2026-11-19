import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { DirectionProvider } from '@/components/foundations/direction/direction'
import { Toaster } from '@/components/base/toast/toast'
import {
  getPublicLoginConfigFn,
  getPublicSiteFn,
  getSessionFn,
} from '#/server/fns/site'

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
  beforeLoad: async () => {
    const session = await getSessionFn().catch(() => null)
    return { session }
  },
  loader: async () => {
    const [site, auth] = await Promise.all([
      getPublicSiteFn().catch(() => null),
      getPublicLoginConfigFn().catch(() => ({
        emailPassword: { enabled: false, verificationRequired: false },
        social: [],
        passkey: { enabled: false },
      })),
    ])
    return { site, auth }
  },
  head: ({ loaderData }) => {
    const faviconUrl = loaderData?.site?.faviconUrl
    return {
      meta: [
        { charSet: 'utf-8' },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1',
        },
        {
          title: loaderData?.site?.siteName ?? 'asms2',
        },
        {
          name: 'description',
          content: loaderData?.site?.siteDescription ?? 'A Simple Mail Server',
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
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
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
