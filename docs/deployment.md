# 部署与运维

## 1. 环境变量

写入 `.env.local`（本地）或部署平台的环境变量（生产）。`.env.local` 已被 `.gitignore` 忽略；模板见根目录 [`.env.example`](../.env.example)。

| 变量                    | 必填     | 说明                                                             |
| ----------------------- | -------- | ---------------------------------------------------------------- |
| `DATABASE_URL`          | ✅       | 本地 `file:./data/asms2.db`；远程 `libsql://<db>-<org>.turso.io` |
| `DATABASE_AUTH_TOKEN`   | 远程必填 | Turso token                                                      |
| `BETTER_AUTH_SECRET`    | ✅       | ≥32 字节随机串                                                   |
| `BETTER_AUTH_URL`       | ✅       | 对外地址，如 `https://mail.example.com`；影响 OAuth 回调         |
| `SECRET_ENCRYPTION_KEY` | ✅       | **32 字节 base64**；丢失后所有服务商/OAuth/Webhook 密钥需重录    |
| `CRON_SECRET`           | ✅       | `/api/cron/sweep` 的 Bearer Token                                |
| `BOOTSTRAP_ADMIN_EMAIL` | 建议     | 首个管理员邮箱，仅在站内无管理员时自动提权                       |

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -base64 32   # SECRET_ENCRYPTION_KEY（必须 32 字节）
openssl rand -hex 16      # CRON_SECRET
```

> 生产环境不要把密钥写进镜像或仓库；`SECRET_ENCRYPTION_KEY` 建议纳入密钥管理，变更会导致历史密文无法解密。

## 2. 构建与运行

```bash
bun install
bun run db:migrate          # 首次 / 每次发布有迁移时
bun run build
node .output/server/index.mjs
```

- 构建产物是自包含 Node 服务（Nitro `node-server` preset），默认监听 3000。
- Node ≥ 20；`better-sqlite3` 已移除，无需编译原生模块（libSQL 自带绑定）。
- 健康检查建议请求 `/login`（走 SSR 与数据库），不要只探端口。
- **首次上线后，管理员应注册 `admin@<域名>` 长期邮箱**：`postmaster`、`abuse`、`noreply` 等保留前缀的来信会统一转投到同域名的 `admin@`，用于接收功能与职能邮件；不创建则这些来信会按 unrouted 处理。

## 3. Nginx 反向代理

```nginx
server {
  listen 443 ssl http2;
  server_name mail.example.com;

  ssl_certificate     /etc/letsencrypt/live/mail.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/mail.example.com/privkey.pem;

  client_max_body_size 12m;   # 发件附件上限 10MB，留余量

  location / {
    proxy_pass         http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }
}
```

- 必须透传 `X-Forwarded-For/Proto`，否则限流、审计与 OAuth 回调地址会出错。
- 若前面还有 CDN，确认 Webhook 路径没有被缓存或拦截（`/api/webhooks/*` 与 `/api/telegram/webhook` 应为 POST 直通）。

## 4. 定时任务

```cron
* * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://mail.example.com/api/cron/sweep >/dev/null
```

`sweep` 负责：临时邮箱到期落库、grace 后清空邮件、回收站过期清理、墓碑与 Webhook 事件回收、Telegram update 去重记录与过期绑定码回收。

- 未配置 `CRON_SECRET` 时接口返回 401。
- 多实例部署时只需**一个**调度源，重复执行是幂等的但浪费。
- cron 停摆不会让失效邮箱复活：读取侧有惰性过期判定，只是清理会延后。

## 5. 备份与回滚

**本地 SQLite**

```bash
sqlite3 data/asms2.db ".backup data/backup-$(date +%F).db"
```

**Turso**

```bash
turso db dump <db-name> > backup-$(date +%F).sql
```

- 迁移前必须备份；发布保留上一版镜像。
- 表结构只做加法：新列可空或有默认值，旧代码仍可运行。
- 回滚 = 切回上一版镜像 + 必要时恢复备份；不要依赖"向下迁移"。
- 密钥轮换（`SECRET_ENCRYPTION_KEY`）需要先解密再重加密，不能直接替换。

## 6. 观测与排障

- 日志为结构化输出，关键字段：`reqId`、`userId`、`route`、`provider`、`durationMs`、`code`。
- 重点指标：收件入库延迟、Webhook 失败率、发件成功率、配额拒绝次数、临时邮箱存量。
- `webhook_event` 表即死信队列：管理后台「日志 → Webhook」可看失败原因，修复后可重放。
- `unrouted_message` 记录"收下了但没投递"的邮件，排查地址拼写/过期问题。

常见问题：

| 现象           | 排查顺序                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 收不到邮件     | 域名 verified → `dig MX` 是否指向 Resend（优先级 10）→ Resend Webhook 是否触发 → 后台 Webhook 日志 → 是否会写进了墓碑表 |
| 发件 403       | `from` 域名是否与已验证域名完全一致；是否用了 `resend.dev` 沙箱地址                                                     |
| 发件 502       | 服务商 Key 是否有效；后台服务商状态；Resend 日志                                                                        |
| 登录后立刻掉线 | `BETTER_AUTH_URL` 与访问域名是否一致；Cookie 是否被代理丢弃                                                             |
| 第三方登录报错 | 回调地址是否为 `{BETTER_AUTH_URL}/api/auth/callback/{provider}`；保存后是否等足 30–60s                                  |

## 7. 上线检查清单

- [ ] 环境变量齐全，`SECRET_ENCRYPTION_KEY` 已备份到密钥管理
- [ ] 已执行 `db:migrate`，并验证 `/login` 可打开
- [ ] 已添加 Resend Key、域名验证通过、Webhook 有事件
- [ ] 管理员已注册 `admin@` 邮箱，保留前缀（`postmaster`、`abuse`、`noreply` 等）来信可正常转投
- [ ] `CRON_SECRET` 已配置，cron 每分钟命中且日志正常
- [ ] 已用真实地址完成一次"收件 + 发件"闭环
- [ ] 已关闭演示数据（`scripts/seed-demo.ts` 不得在生产执行）
- [ ] 备份任务与磁盘空间已确认
