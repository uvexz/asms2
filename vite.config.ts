import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

/**
 * 打包期日志里确认无害、无需人工处理的 code。
 *
 * - `MODULE_LEVEL_DIRECTIVE`：react-router / react-query / framer-motion 为兼容
 *   Next.js RSC 在模块首行写了 "use client"。本项目不是 RSC 运行时，这条指令
 *   不参与任何逻辑，rolldown 丢弃它是预期行为——但每个文件都会报一条（近百条）。
 * - 其余四个是 nitro 默认就会忽略的 code，这里覆盖 onwarn 后需要自己保留。
 */
const IGNORED_BUILD_WARNING_CODES = new Set([
  'EVAL',
  'CIRCULAR_DEPENDENCY',
  'THIS_IS_UNDEFINED',
  'EMPTY_BUNDLE',
  'MODULE_LEVEL_DIRECTIVE',
])

/** 打包日志的最小结构，避免直接依赖 rollup/rolldown 的内部类型。 */
type BundlerWarning = {
  code?: string
  message: string
}

type BundlerLogLevel = 'debug' | 'info' | 'warn'

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
      rollupConfig: {
        external: [/^@sentry\//],
        onwarn(
          warning: BundlerWarning,
          defaultHandler: (warning: BundlerWarning) => void,
        ) {
          if (warning.code && IGNORED_BUILD_WARNING_CODES.has(warning.code)) {
            return
          }
          defaultHandler(warning)
        },
        // nitro 内部给 node_modules 分组用的是 `name: (id) => ...` 且没设 debugName，
        // rolldown 因此提示计时报告无法识别分组。分组逻辑在 nitro 里，改动它等于
        // 接管产物分块命名，收益不抵风险，这里只静默这条提示本身。
        onLog(
          level: BundlerLogLevel,
          log: BundlerWarning,
          defaultHandler: (level: BundlerLogLevel, log: BundlerWarning) => void,
        ) {
          if (log.message.includes('codeSplitting.groups[0].debugName')) return
          defaultHandler(level, log)
        },
      },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
