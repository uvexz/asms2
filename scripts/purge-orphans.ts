/**
 * 一次性清理：删除 message 已不存在、但 message_body / attachment 仍残留的孤儿行。
 *
 * 背景：早期版本依赖 ON DELETE CASCADE，而 libSQL 连接池里只有首个连接开了
 * PRAGMA foreign_keys，sweep 删除邮件后正文可能残留。新版 sweep 已改为显式删除，
 * 这个脚本只用来收拾升级前留下的数据。可重复执行。
 *
 * 运行：bunx tsx scripts/purge-orphans.ts
 */
import '#/server/env'

import { sql } from 'drizzle-orm'

import { db } from '#/db/client'

const BATCH = 1_000

async function purge(table: 'message_body' | 'attachment'): Promise<number> {
  const keyColumn = table === 'message_body' ? 'message_id' : 'id'
  let total = 0

  for (;;) {
    const result = await db.run(
      sql.raw(`
        delete from ${table}
        where ${keyColumn} in (
          select t.${keyColumn} from ${table} t
          where not exists (select 1 from message m where m.id = t.message_id)
          limit ${BATCH}
        )
      `),
    )
    const deleted = Number(result.rowsAffected)
    total += deleted
    if (deleted < BATCH) break
  }

  return total
}

async function main() {
  const bodies = await purge('message_body')
  const attachments = await purge('attachment')
  console.log(
    `[purge-orphans] message_body: ${bodies}, attachment: ${attachments}`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[purge-orphans] failed:', error)
    process.exit(1)
  })
