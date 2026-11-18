# asms2

**A Simple Mail Server v2** —— 基于 Resend 的多用户收发件与临时邮箱服务。

> asms2 是邮件**应用层**，不是 MTA：发件走 Resend API，收件由 Resend 代收后 Webhook 回推。不提供 SMTP/IMAP，也无法在 SMTP 层退信。

## 功能

- **长期邮箱**：数量受配额限制（默认 5 个），前缀 ≥3 位，可收发。
- **临时邮箱**：数量不限，前缀 ≥8 位；**创建后 1 小时内收到任意邮件即永久保留，否则失效**。
- **三栏邮件界面**：默认展示全部邮箱，可按邮箱 / 文件夹 / 关键词筛选，支持写信、回复、星标、回收站。
- **管理后台**：站点配置、域名与 DNS 接入、多服务商 Key、Webhook、第三方登录、用户与日志。
- **Telegram 机器人**：新邮件推送（自动提取验证码）、临时邮箱自助创建、会话级通知开关。
- **域名级开关**：每个域名可独立控制"允许新建长期邮箱 / 允许新建临时邮箱"。
- **对外 API**：API Key 鉴权，支持发信、读信、建邮箱。

## 快速开始

要求 Bun ≥ 1.4，Node ≥ 20（生产运行）。

```bash
bun install
cp .env.example .env.local   # 按注释替换三个密钥
bun run db:migrate
bun run dev                  # http://localhost:3000
```

变量含义与生成命令见 [`.env.example`](./.env.example) 注释；`BETTER_AUTH_SECRET`、`SECRET_ENCRYPTION_KEY`、`CRON_SECRET` 三项必须替换，`DATABASE_URL` 默认是本地 SQLite。

注册后，`BOOTSTRAP_ADMIN_EMAIL` 对应账号在站内无管理员时会自动提权。随后到 `/admin/providers` 填服务商 Key、`/admin/domains` 接入域名，详见 [服务商接入](./docs/providers/)（Resend / UnitPost / AhaSend / Groundmail / Mailtrap / Plunk / Reloop）。

> 只看界面可执行 `bunx tsx scripts/seed-demo.ts`（写入假服务商与演示域名，**生产禁用**）。

## 文档

| 文档                                           | 内容                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| [docs/architecture.md](./docs/architecture.md) | 定位、模块、数据模型、权限、关键流程、前端与安全                        |
| [docs/deployment.md](./docs/deployment.md)     | 环境变量、Nginx、cron、备份、排障、上线清单                             |
| [docs/providers/](./docs/providers/)           | 服务商接入：Resend / UnitPost / AhaSend / Groundmail / Mailtrap / Plunk / Reloop |
| [docs/telegram.md](./docs/telegram.md)         | Telegram 机器人配置、命令、安全与排障                                   |
| [docs/api.md](./docs/api.md)                   | 对外 REST API、错误码、限流                                             |
| [docs/database.md](./docs/database.md)         | 迁移流程、SQLite/Turso、字段约定                                        |
| [docs/development.md](./docs/development.md)   | 目录、命令、改动流程、质量门                                            |
| [docs/status.md](./docs/status.md)             | 已完成、未实现、已知风险                                                |
| [AGENTS.md](./AGENTS.md)                       | 项目硬性约定与 BoardUI 规则                                             |

## 技术栈

TanStack Start（Vite + Nitro）· TanStack Query · BoardUI + Tailwind v4 · Drizzle + libSQL（Turso/本地 SQLite）· Better Auth · Resend。

## 已知限制

- 无 SMTP/IMAP；地址不存在只能落墓碑或丢弃，无法退信。
- 附件只存元数据，暂未实现代理下载；无会话线程与全文检索。
- 管理员默认不可读邮件正文；注册暂未接邮箱验证与找回密码。
