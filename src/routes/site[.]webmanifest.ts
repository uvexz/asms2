import { createFileRoute } from '@tanstack/react-router'

import { getSiteSettings } from '#/server/settings'

/** /public 下的默认安卓图标；站点配置了 faviconUrl 时改用自定义图标 */
const DEFAULT_ICONS = [
  { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
  { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
  {
    src: '/android-chrome-512x512.png',
    sizes: '512x512',
    type: 'image/png',
    purpose: 'maskable',
  },
]

/**
 * PWA manifest：名称与描述取自站点配置，避免静态文件写死站名。
 * 文件名里的 `[.]` 是 TanStack Router 的字面点转义，实际路径为 /site.webmanifest。
 */
export const Route = createFileRoute('/site.webmanifest')({
  server: {
    handlers: {
      GET: async () => {
        const site = await getSiteSettings().catch(() => null)
        const name = site?.siteName ?? 'asms2'
        const faviconUrl = site?.faviconUrl

        const manifest = {
          name,
          short_name: name.slice(0, 12),
          description: site?.siteDescription ?? 'A Simple Mail Server',
          lang: 'zh-CN',
          dir: 'ltr',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#ffffff',
          theme_color: '#ffffff',
          icons: faviconUrl
            ? [{ src: faviconUrl, sizes: 'any', type: 'image/png' }]
            : DEFAULT_ICONS,
        }

        return new Response(JSON.stringify(manifest), {
          headers: {
            'content-type': 'application/manifest+json',
            'cache-control': 'public, max-age=300',
          },
        })
      },
    },
  },
})
