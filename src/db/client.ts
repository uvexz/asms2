import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'

import * as schema from './schema'

/**
 * 同一个驱动同时支持：
 *   file:./data/asms2.db        → 本地 SQLite（开发 / 单机部署）
 *   libsql://xxx.turso.io       → Turso 远程（生产 / 多实例）
 */
const url = process.env.DATABASE_URL ?? 'file:./data/asms2.db'
const isLocal = url.startsWith('file:')

if (isLocal) {
  const filePath = url.slice('file:'.length)
  if (filePath && filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true })
  }
}

export const client = createClient({
  url,
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  // 本地文件库的 busy timeout；远程 Turso 会忽略该选项
  ...(isLocal ? { timeout: 5_000 } : {}),
})

export const db = drizzle(client, { schema })

export const isLocalDatabase = isLocal

let pragmasReady: Promise<void> | null = null

/**
 * WAL 是数据库文件的持久属性，设置一次即可；busy timeout 由上面的 timeout
 * 选项应用到每个池连接。synchronous 是连接级参数，这里只覆盖首个连接，
 * 池中后续连接仍为默认值，但 WAL 已避免读写互斥。
 */
export function ensurePragmas(): Promise<void> {
  if (!isLocal) return Promise.resolve()
  if (!pragmasReady) {
    pragmasReady = (async () => {
      try {
        await client.execute('PRAGMA journal_mode = WAL')
        await client.execute('PRAGMA synchronous = NORMAL')
      } catch (error) {
        console.error('[db] 本地 SQLite 参数初始化失败:', error)
      }
    })()
  }
  return pragmasReady
}

if (isLocal) {
  await ensurePragmas()
}

export type Database = typeof db
export { schema }
