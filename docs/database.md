# 数据库与迁移

## 1. 数据源

同一套 schema 支持两种运行形态：

| 形态        | `DATABASE_URL`                 | 说明                                  |
| ----------- | ------------------------------ | ------------------------------------- |
| 本地 SQLite | `file:./data/asms2.db`         | 开发与单机部署；启动时自动创建目录    |
| Turso       | `libsql://<db>-<org>.turso.io` | 生产/多实例；需 `DATABASE_AUTH_TOKEN` |

驱动是 `@libsql/client` + `drizzle-orm/libsql`。`drizzle.config.ts` 会根据 URL 前缀自动切换 `sqlite` / `turso` 方言，迁移文件两边共用。

本地 `file:` 模式启动时会启用 WAL，并为每个池连接设置 5 秒 busy timeout，避免 Webhook、定时清理与面板请求并发时直接抛 `SQLITE_BUSY`；Turso 远程模式忽略这些本地 pragma。

## 2. 迁移流程

```bash
# 1. 修改 src/db/schema/*
# 2. 生成 SQL
bun run db:generate
# 3. 人工检查 drizzle/00xx_*.sql（必做）
# 4. 应用
bun run db:migrate
```

> `db:generate` 遇到"删除列 + 新增列"会要求交互确认，非 TTY 环境会直接失败。本项目约定**不删列**，因此正常不会触发。

### 2.1 只做加法

- 新列必须有默认值或可空，保证旧代码/旧数据可用。
- 不删列：SQLite 删列会重建整表，而 `domain` 被 `mailbox` 外键引用，重建有风险。
- 废弃列保留并标 `@deprecated`。现有例子：`domain.purpose`（由 `allow_permanent_create` / `allow_temp_create` 取代）。
- 不做"向下迁移"；回滚靠镜像 + 备份。

### 2.2 数据回填

结构变更需要修数据时，直接追加到生成的迁移文件里（迁移是纯 SQL，按顺序执行）。例：`drizzle/0002_wise_ser_duncan.sql` 在加列后回填历史临时邮箱：

```sql
UPDATE mailbox
SET retained_at = last_received_at, expires_at = NULL, status = 'active'
WHERE kind = 'temp' AND last_received_at IS NOT NULL
  AND status IN ('active', 'expired');
```

### 2.3 迁移前

- 本地：`cp data/asms2.db data/backup-$(date +%F).db`
- Turso：`turso db dump <db> > backup-$(date +%F).sql`
- 生产发布：先迁移再切流量；迁移必须是向后兼容的。

## 3. SQL 使用约束

两端（本地 SQLite / Turso）都要能跑：

- ✅ 普通索引、UNIQUE、UPSERT、`db.batch([...])`、子查询。
- ❌ 触发器、`ATTACH`、自定义函数、长事务、`VACUUM INTO` 之类的本地特性。
- 多表写入用 `batch` 一次提交，避免远程库多次往返与半写状态。
- 远程库不要用 `db.transaction()` 包裹多个网络往返。

## 4. 字段约定

| 项   | 约定                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------- |
| 时间 | `integer(..., { mode: 'timestamp' })`，存 Unix **秒**；API 输出毫秒                                                    |
| 主键 | `text`，nanoid（20 位）                                                                                                |
| 布尔 | `integer({ mode: 'boolean' })`                                                                                         |
| 枚举 | `text` + TS 联合类型（SQLite 无原生 enum）                                                                             |
| JSON | `text`，字段名以 `Json` 结尾，读取时 `JSON.parse`                                                                      |
| 软删 | `status='deleted'` + `deletedAt`；地址改写为 `原地址#id` 释放唯一索引；邮件立即隐藏，保留期与冷却期后由 sweep 分块硬删 |

## 5. 关键索引

- `mailbox(address)`、`(domain_id, local_part)`：地址唯一与反查。
- `mailbox(kind, status, expires_at)`：清理任务扫描。
- `mailbox(user_id, kind, created_at)`：临时邮箱创建限流。
- `message(mailbox_id, folder, received_at, id)`、`(user_id, folder, received_at, id)`：列表分页与游标排序。
- `message(folder, received_at)`：回收站等按文件夹清理。
- `message(provider_config_id, provider_message_id)` UNIQUE：收发幂等。
- `apikey(key)`：API Key 校验，避免全表扫描。
- `session(expires_at)`、`verification(expires_at)`：过期会话与验证记录清理。
- `daily_usage(user_id, usage_date)` UNIQUE、`(usage_date)`：配额 UPSERT 与历史清理。
- `webhook_event(endpoint_id, provider_event_id)` UNIQUE：重复事件去重。
- `unrouted_message(provider_message_id)`：墓碑查重。

加查询之前先翻一眼现有索引，八成已经有能用的。另外列表查询别随手 `SELECT *`——`message_body` 会被一起拖出来，列表立刻慢一个量级。

## 6. 本地重建

```bash
rm -f data/asms2.db
bun run db:migrate
bunx tsx scripts/seed-demo.ts   # 可选，仅本地演示
```

`data/*.db` 已被 `.gitignore` 忽略；迁移 SQL 必须提交。
