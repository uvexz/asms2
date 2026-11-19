//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
      // 项目是 Vite + TanStack Start，没有 next/image；BoardUI 组件的 <img> 是正确写法。
      '@next/next/no-img-element': 'off',
    },
  },
  {
    ignores: [
      'eslint.config.js',
      'prettier.config.js',
      // 构建产物，已在 .gitignore；带哈希的 chunk 进了 @typescript-eslint 的 project 会直接报解析失败。
      '.output/**',
      'dist/**',
      'dist-ssr/**',
      '.nitro/**',
      '.tanstack/**',
      '.vinxi/**',
      '.wrangler/**',
    ],
  },
]
