# asms2

**A Simple Mail Server v2** —— 自托管的邮件应用：收发走服务商 API，管多用户和临时邮箱，另带一套 REST API。

它不做 MTA。发信交给服务商，收信由对方代收后用 Webhook 回推，需要正文再回查一次。所以没有 SMTP / IMAP，也没法在投递阶段退信——地址不存在就是收不下，只能落墓碑或者丢掉。

## 能做什么

- **长期邮箱**：一人最多 5 个（可改），前缀至少 3 位，能收能发。删掉的地址冷却 30 天才放出来。
- **临时邮箱**：不限量，前缀至少 8 位，默认只收不发。开出来 1 小时内收到任意一封邮件就永久留下；一封都没等到，就作废，不续期也不复活。
- **收发界面**：三栏，默认把全部邮箱的信混在一起，能按邮箱、文件夹、关键词筛。写信、回复、星标、回收站都有。搜索只匹配主题和发件人，不翻正文。
- **换服务商不用换界面**：一个域名绑一家服务商，换掉之后地址、邮件、历史都不动。每个域名单独控制能不能新建长期或临时地址，也能单独关掉发信。
- **管理后台**：站点配置、域名与 DNS、服务商 Key、Webhook、登录方式、用户、日志。
- **登录**：邮箱密码（邮箱验证可开可关）、Google / GitHub / OIDC、Passkey、对外 API Key。找回密码走系统邮件通道。
- **Telegram**：新邮件推到私聊，识别到验证码会单独拎出来；`/new` 直接在对话里开临时地址。只处理私聊，群组消息一律拒绝。
- **对外 API**：`/api/v1/mailboxes`、`/api/v1/send`、`/api/v1/messages`，Key 鉴权，带限流。
- **定时任务**：过期邮箱、回收站、墓碑、Webhook 事件、Telegram 去重记录的清理。

## 服务商

| `kind`       | 服务商     | 发件 | 收件 | 域名 API | Webhook | 文档                                            |
| ------------ | ---------- | ---- | ---- | -------- | ------- | ----------------------------------------------- |
| `resend`     | Resend     | ✅   | ✅   | ✅       | ✅      | [resend.md](./docs/providers/resend.md)         |
| `unitpost`   | UnitPost   | ✅   | ✅   | ✅       | ✅      | [unitpost.md](./docs/providers/unitpost.md)     |
| `ahasend`    | AhaSend    | ✅   | ✅   | ✅       | ✅      | [ahasend.md](./docs/providers/ahasend.md)       |
| `groundmail` | Groundmail | ✅   | ✅   | ✅       | ✅      | [groundmail.md](./docs/providers/groundmail.md) |
| `mailtrap`   | Mailtrap   | ✅   | ✅   | ✅       | ✅      | [mailtrap.md](./docs/providers/mailtrap.md)     |
| `plunk`      | Plunk      | ✅   | ✅   | ✅       | ✅      | [plunk.md](./docs/providers/plunk.md)           |
| `reloop`     | Reloop     | ✅   | ✅   | ✅       | ✅      | [reloop.md](./docs/providers/reloop.md)         |
| `custom`     | 兼容网关   | ✅   | ✅   | ✅       | ✅      | 自填 API 基地址，协议与 Resend 一致             |

七家都是完整实现，不是只做了发信。`custom` 给自建或第三方的 Resend 协议网关用：`POST /emails`、Svix 验签、`/emails/receiving/{id}`，对得上就能接。

适配层只有 `src/server/providers/types.ts` 这一个接口。Webhook 进来先归一成 `inbound / status / ignored`，业务层看不到 `email_id`、`message.routing` 这种服务商私有字段。加一家服务商就是加一个文件、注册一次。

## 跑起来

开发和构建用 Bun，生产跑 Node ≥ 20。

```bash
bun install
cp .env.example .env.local   # 三个必须项要换掉
bun run db:migrate
bun run dev                  # http://localhost:3000
```

必须换的三个是 `BETTER_AUTH_SECRET`、`SECRET_ENCRYPTION_KEY`、`CRON_SECRET`，生成命令写在 [`.env.example`](./.env.example) 里。`DATABASE_URL` 默认指向本地 SQLite，也可以填 Turso 地址（另外要给 `DATABASE_AUTH_TOKEN`）。

注册完，`BOOTSTRAP_ADMIN_EMAIL` 那个账号在站内还没有管理员时会自动提权。然后去 `/admin/providers` 填服务商 Key，`/admin/domains` 接域名。

管理员顺手把 `admin@<域名>` 注册了：`postmaster`、`abuse`、`noreply` 这些保留前缀的来信会统一转投到它，不建的话这些信按 unrouted 处理。

只想看界面的话，`bunx tsx scripts/seed-demo.ts` 会塞一套假服务商和演示域名。生产别跑。

提交前过两道：`bunx tsc --noEmit` 和 `bun run build`。

## 上线

```bash
bun run db:migrate          # 首次，以及每次带迁移的发布
bun run build
node .output/server/index.mjs   # Nitro node-server，默认 3000
```

Nginx、cron、备份回滚这些在 [docs/deployment.md](./docs/deployment.md)。

## 技术栈

TanStack Start（Vite + Nitro，`node-server`）· TanStack Router / Query · React 19 + BoardUI（Tailwind v4）· Drizzle + libSQL（本地 SQLite / Turso）· Better Auth（密码、OAuth、OIDC、Passkey、API Key）。服务商适配层是自己写的 HTTP 客户端，只有 Resend 和 `custom` 用官方 SDK。

## 文档

| 文档                                           | 内容                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| [docs/architecture.md](./docs/architecture.md) | 定位、模块、数据模型、权限、关键流程、前端与安全                                 |
| [docs/deployment.md](./docs/deployment.md)     | 环境变量、Nginx、cron、备份、排障、上线清单                                      |
| [docs/providers/](./docs/providers/)           | 服务商接入：Resend / UnitPost / AhaSend / Groundmail / Mailtrap / Plunk / Reloop |
| [docs/telegram.md](./docs/telegram.md)         | Telegram 机器人配置、命令、安全与排障                                            |
| [docs/api.md](./docs/api.md)                   | 对外 REST API、错误码、限流                                                      |
| [docs/database.md](./docs/database.md)         | 迁移流程、SQLite / Turso、字段约定                                               |
| [docs/development.md](./docs/development.md)   | 目录、别名、命令、改动流程、质量门                                               |
| [docs/status.md](./docs/status.md)             | 已完成、已验证链路、未实现、已知风险                                             |
| [AGENTS.md](./AGENTS.md)                       | 项目硬性约定与 BoardUI 规则                                                      |

## 还差什么

有些是故意没做的，不是排期问题：

- 没有 SMTP / IMAP。发往不存在或已失效地址的邮件，只能落 `unrouted_message` 或者丢掉，接口照样返回 200。
- 附件只存元数据（文件名、大小），下载还没做。也没有会话线程，搜索只做主题和发件人的 `LIKE`。
- 管理员默认读不到正文，后台可以开；不提供代发，也不做邮箱共享。
- 实时性靠轮询：邮件列表 20 秒、邮箱列表 60 秒，标签页切走就停。没上 SSE / WebSocket。界面只有中文。
- 改邮箱地址的验证流程还没写（找回密码已经有了）。
