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

- 构建出来是个自包含的 Node 服务（Nitro `node-server`），默认监听 3000。
- Node ≥ 20 就行。`better-sqlite3` 早就移掉了，不用编译原生模块，libSQL 自带绑定。
- 健康检查别只探端口，请求 `/login` 更有意义——它要过 SSR 和数据库。
- **上线后第一件事：让管理员注册 `admin@<域名>` 长期邮箱**。`postmaster`、`abuse`、`noreply` 这些保留前缀的来信会统一转投到它，用来接功能和职能邮件；不建，这些信就按 unrouted 处理了。

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
- 构建会在 `public/assets` 下生成 gzip/brotli 预压缩文件，Nitro 会按 `Accept-Encoding` 直接返回；如需压缩 SSR HTML，可在 Nginx 额外开启 `gzip on; gzip_types text/html text/css application/javascript application/json;`。

## 4. 定时任务

```cron
* * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://mail.example.com/api/cron/sweep >/dev/null
```

`sweep` 负责：临时邮箱到期落库、grace 后清空邮件、已删除邮箱在保留期与冷却期结束后的邮件/墓碑清理、回收站过期清理、墓碑与 Webhook 事件回收、Telegram update 去重记录与过期绑定码回收。

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

- 每个非静态请求输出一行 JSON：`type=request`、`reqId`、`method`、`path`、`status`、`durationMs`；4xx 用 `console.warn`，5xx 用 `console.error`。
- 成功请求只在耗时 ≥1s 时记录，避免 20s/60s 轮询随打开的标签线性放大日志量；慢请求阈值定义在 `src/server/plugins/request-timing.ts`。
- 响应头会返回 `x-request-id`（客户端传入合法值时会复用）；`/assets/**`、Vite 模块请求及常见静态文件扩展名不记录，避免日志噪音。
- 重点指标：收件入库延迟、Webhook 失败率、发件成功率、配额拒绝次数、临时邮箱存量。
- `webhook_event` 表即死信队列：管理后台「日志 → Webhook」可看失败原因，修复后可重放。
- `unrouted_message` 记录"收下了但没投递"的邮件，排查地址拼写/过期问题。

常见问题：

| 现象             | 排查顺序                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 收不到邮件       | 域名是否 verified → `dig MX` 有没有指向服务商给的地址（优先级 10）→ 服务商侧 Webhook 是否触发 → 后台 Webhook 日志 → 是不是写进墓碑表了 |
| 发件 403         | `from` 域名和已验证域名是否完全一致；是不是还在用沙箱地址（Resend 的 `resend.dev`）                                                    |
| 发件 502         | 服务商 Key 是否还有效；后台服务商状态；服务商控制台里的发信日志                                                                        |
| 登录后立刻掉线   | `BETTER_AUTH_URL` 与访问域名是否一致；Cookie 是否被代理丢弃                                                                            |
| 第三方登录报错   | 回调地址是否为 `{BETTER_AUTH_URL}/api/auth/callback/{provider}`；保存后是否等足 30–60s                                                 |
| Passkey 无法使用 | `BETTER_AUTH_URL` 必须是 `https://` 正式域名（本机 localhost 除外），且与浏览器访问地址完全一致                                        |

### 缓存与多实例

- 站点配置（10s）、公开登录方式（60s）、Telegram Bot 配置（10s）、Auth 实例（30s 版本检查）都是**进程内缓存**，多实例 / Serverless 下不共享；写操作只失效当前进程，其它实例最多滞后一个 TTL。
- `/mail`、`/admin`、`/settings`、认证页的 SSR HTML 由 `vite.config.ts` 的 `routeRules` 显式返回 `Cache-Control: private, no-store`，可直接放在 CDN 后面而不担心串号。
- `/assets/*` 是带 hash 的构建产物，但应用服务器不写缓存头；请在 Nginx / CDN 层补 `Cache-Control: public, max-age=31536000, immutable`。
- server fn 与 `/api/v1/*` 默认不带缓存头，保持私有数据不被中间层缓存；`/site.webmanifest` 为 `max-age=300`。
- `/mail` 的首屏数据在路由 loader 里预取并随 SSR 脱水；排查"首屏只有骨架"时先确认服务端没有在 loader 阶段抛错（错误会走路由错误边界）。

## 7. 上线检查清单

- [ ] 环境变量齐全，`SECRET_ENCRYPTION_KEY` 已备份到密钥管理
- [ ] 已执行 `db:migrate`，并验证 `/login` 可打开
- [ ] 已加服务商 Key、域名验证通过、Webhook 收到过事件
- [ ] 管理员已注册 `admin@` 邮箱，保留前缀（`postmaster`、`abuse`、`noreply` 等）来信可正常转投
- [ ] `CRON_SECRET` 已配置，cron 每分钟命中且日志正常
- [ ] 已用真实地址完成一次"收件 + 发件"闭环
- [ ] 已关闭演示数据（`scripts/seed-demo.ts` 不得在生产执行）
- [ ] 备份任务与磁盘空间已确认
