import { config } from 'dotenv'

/**
 * 开发态兜底：Vite 只会把 .env* 注入 import.meta.env，
 * 服务端代码需要 process.env，这里补一次（生产环境变量已存在时跳过）。
 */
if (!process.env.DATABASE_URL) {
  config({ path: ['.env.local', '.env'] })
}
