import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    nitro({
      compressPublicAssets: { gzip: true, brotli: true },
      plugins: ['./src/server/plugins/request-timing.ts'],
      routeRules: {
        // 个性化页面绝不进共享缓存；前面加 CDN 时也不会误缓存别人的邮箱
        '/mail/**': { headers: { 'cache-control': 'private, no-store' } },
        '/admin/**': { headers: { 'cache-control': 'private, no-store' } },
        '/settings': { headers: { 'cache-control': 'private, no-store' } },
        '/login': { headers: { 'cache-control': 'private, no-store' } },
        '/register': { headers: { 'cache-control': 'private, no-store' } },
        '/forgot-password': {
          headers: { 'cache-control': 'private, no-store' },
        },
        '/reset-password': {
          headers: { 'cache-control': 'private, no-store' },
        },
        '/verify-email': { headers: { 'cache-control': 'private, no-store' } },
      },
      rollupConfig: { external: [/^@sentry\//] },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
