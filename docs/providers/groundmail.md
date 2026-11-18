# Groundmail 接入

## 1. 边界

Groundmail 是「发信接口长得像 Resend」的服务商，适配器代码在 `src/server/providers/groundmail.ts`：

- 发件：`POST /emails`，Bearer `gm_...`；字段名与 Resend 一致（`from` / `to` / `subject` / `html` / `text` / `reply_to` / `cc` / `bcc` / `headers` / `attachments` / `Idempotency-Key`）。
- 收件：域名开启入站并把 MX 指向 `mx.groundmail.dev` 后，`email.received` Webhook **只推元数据**，正文由适配器再调 `GET /received-emails/{id}` 拉取。
- 域名：`POST /domains` 创建，`POST /domains/{id}` + `{ "action": "verify" }` 触发 DNS 检查。
- 基地址：`https://api.groundmail.dev`（可在服务商配置里用 `API Base URL` 覆盖）。

> 它**不是** Resend 协议的全兼容实现，所以走独立适配器，而不是「兼容 Resend 协议」的 `custom`：
> 验签是 Stripe 风格（`Groundmail-Signature`）而非 Svix，入站取件是 `/received-emails/{id}` 而非 `/emails/receiving/{id}`，域名接口是 `{ domain, records }` 包裹结构。三者直接换 base URL 都会失败。

## 2. 接入步骤

### 2.1 API Key

Groundmail 控制台 → API Keys → 创建，至少需要：

- 发件权限
- 收件读取权限（`GET /received-emails`）
- 域名读写权限（自动创建 / 验证域名）

填到「管理后台 → 服务商」，类型选 `Groundmail`，Key 形如 `gm_...`。密钥以 AES-256-GCM 加密存储，界面只显示末四位。

### 2.2 域名

「管理后台 → 域名」添加域名后会调用 `POST /domains`，把返回的 TXT / CNAME / MX 写进 `dnsRecordsJson`：所有权 TXT 在 `_groundmail.<域名>`，DKIM 在 `<selector>._domainkey.<域名>`，return-path 是 `send.` 子域的 CNAME。

点「验证」时调用 `POST /domains/{id}`：

- 只有 **DKIM** 与 **return-path** 都被邮件服务器认到，域名才算 `verified`；
- DMARC 只回报、不阻断验证；
- DNS 已发布但邮件服务器还没同步时，Groundmail 直接回 **400**，适配器会提示「等 DNS 传播后再点验证」——隔几分钟重试即可。

**建议用子域**（`mail.example.com` / `temp.example.com`）：根域通常已被企业邮箱占用 MX，混用会互相抢信。

### 2.3 开启入站（必须手工确认）

适配器**不会**在建域名时自动开入站 —— 开入站要改 MX，会接管该名字下的全部邮件：

1. Groundmail 控制台 → 域名 → 开启 inbound；或 `PATCH /domains/{id}`，body `{ "inbound_enabled": true }`。
2. 发布返回的 MX：`<你的域名> MX 10 mx.groundmail.dev`。域名已有 MX（Google Workspace / M365 / Fastmail）时**不要**开，换独立子域。
3. 回后台点「验证」，`GET /domains/{id}` 里的 `inbound_records` 会合并进 DNS 列表，确认 `inbound_status = active`。

### 2.4 Webhook

Groundmail 控制台 → Webhooks → 新建，或在后台「服务商 → 收件 Webhook」先建端点拿地址：

- URL：`https://<你的域名>/api/webhooks/groundmail/<endpointId>`
- 事件：`email.received`，以及 `email.sent` / `email.delivered` / `email.delivery_delayed` / `email.bounced` / `email.complained` / `email.failed` / `email.suppressed`。
- Secret：创建端点时返回一次，形如 `whsec_...`，**立刻**粘回端点；之后无法再查看。

未映射的事件（`email.opened` / `email.clicked` / `email.held` / `contact.unsubscribed` / `mailbox.*` / `automation.*`）会被记为 `ignored`，不影响收发主链路。

## 3. 验签

Groundmail 用 Stripe 风格签名，**不是** Svix：

- 头：`Groundmail-Signature: t=<unix 秒>,v1=<hex>`。
- 签名串：`${t}.${rawBody}`，HMAC-SHA256，十六进制；必须用原始请求体。
- 时间窗 ±5 分钟；超时直接 401（不写事件表）。
- 密钥 `whsec_...`：要求按**原文**当 key。适配器额外尝试去掉 `whsec_` 前缀的候选，避免实现差异导致全部 401。
- 比较用 `timingSafeEqual`。

去重键：Groundmail 没有投递 ID 头，适配器用 `类型:主体 ID`（`email.delivered:msg_xxx`、`email.received:inb_xxx`）；没有主体 ID 的事件退回原始载荷的 SHA-256 前 32 位，重投不会重复处理。

Handler 要在 15 秒内回 2xx；否则 Groundmail 会再重试 4 次（5 秒 / 30 秒 / 2 分钟 / 2 分钟）。

## 4. 发件规则

- `from` 必须是已验证域名。适配器用对象形式 `{ email, name }` 传，避开「名称含特殊字符必须加双引号」的坑。
- `to` / `cc` / `bcc` / `reply_to` 只发裸地址（Groundmail 要求每项恰好一个地址，群组和换行会被 400）。
- 幂等：`Idempotency-Key` = `send/{mailboxId}/{uuid}`，24 小时内同 key 同 body 返回首次结果；同 key 不同 body 回 409。
- 附件：规范字段是 `name` / `data`（base64）/ `content_type` / `content_id`；单文件解码后 10MB、整包 20MB、最多 10 个，可执行/脚本扩展名会被拒。
- 响应 `status` 只有 `queued` / `scheduled`；`scheduled` 在本站按 `queued` 记录。
- 沙箱发件域名 `noreply@mail.groundmail.dev` **只能发给 API Key 拥有者自己的邮箱**，测试时注意。

## 5. 收件流程

1. 验签 → 归一化事件（`email.received` → `kind: 'inbound'`，事件名与 `data.email_id` 与 Resend 同构，复用 `email-event.ts`）。
2. 以 `providerMessageId` 去重（`webhook_event` 端点 + 事件 ID 唯一）。
3. 按 `to` 反查 `mailbox`；未命中写 `unrouted_message(unknown)`，临时邮箱过期写 `expired`，均返回 200。
4. 调 `GET /received-emails/{id}` 取 `html_body` / `text_body` / 附件元数据。
5. 把结构化的 `message_id` / `in_reply_to` / `references` 合成为邮件头，保证线程归并与 `internetMessageId` 与其它服务商一致。
6. 净化 HTML 后入库；临时邮箱在考察期内收到首封 → 永久保留。

## 6. 已知限制

| 限制              | 说明                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------- |
| 无原始邮件头      | 只给结构化字段，本站用 `message-id` / `in-reply-to` / `references` 合成，其它头拿不到       |
| 取件会带附件字节  | 检索接口把附件 base64 一起返回，本站只用元数据；大附件邮件会慢，适配器超时放宽到 30 秒      |
| 收件必须改 MX     | 会接管该名字的全部邮件，务必用独立子域                                                      |
| 数据保留期        | Free 7 天 / 按量 90 天，超期 `GET /received-emails/{id}` 返回 404；本站入库后不依赖它       |
| Secret 只显示一次 | Webhook 密钥建端点时返回一次，丢了要重建端点                                                |
| 发信与回执分离    | `POST /emails` 只回 `queued`，`delivered` / `bounced` 靠 webhook 或 `GET /emails/{id}` 回查 |
| 无营销能力        | 没有 audiences / contacts / broadcasts（换成 tenants / automations），`category` 已废弃     |
