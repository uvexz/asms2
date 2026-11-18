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

if (url.startsWith('file:')) {
  const filePath = url.slice('file:'.length)
  if (filePath && filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true })
  }
}

export const client = createClient({
  url,
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
})

export const db = drizzle(client, { schema })

export type Database = typeof db
export { schema }
