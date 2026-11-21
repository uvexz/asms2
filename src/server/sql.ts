import { sql } from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'

/** 转义 LIKE 通配符，配合 `ESCAPE '\'` 使用，让用户输入的 % / _ 按字面匹配 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/** 大小写不敏感的「包含」匹配：lower(expr) LIKE '%term%' ESCAPE '\' */
export function containsInsensitive(expr: SQLWrapper, term: string): SQL {
  const pattern = `%${escapeLike(term.toLowerCase())}%`
  return sql`lower(${expr}) like ${pattern} escape '\\'`
}
