# UnitPost 接入

## 1. 边界

UnitPost 同时提供发件与收件，适配器代码在 `src/server/providers/unitpost.ts`：

- 发件：`POST /api/v1/email`，`from` 必须是该账号下已验证域名。
- 收件：域名开启 Receiving 并把 MX 指向 UnitPost 后，`email.received` Webhook 只推**元数据**，正文由适配器再调 `GET /api/v1/email/received/{id}` 拉取。
- 域名：`POST /api/v1/email/domains` 创建，`POST /api/v1/email/domains/{id}/verify` 触发 DNS 检查。
- 基地址：`https://www.unitpost.com`（可在服务商配置里用 `API Base URL` 覆盖）。

## 2. 接入步骤

### 2.1 API Key

UnitPost 控制台 → API Keys，按最小权限创建，至少需要：

- `emails:send`（发件）
- `emails:read`（收件正文与附件）
- `domains:write`（自动创建 / 验证域名）

填到「管理后台 → 服务商」，选择类型 `UnitPost`。Key 以 AES-256-GCM 加密存储，界面只显示末四位。

### 2.2 域名

「管理后台 → 域名」添加域名后会调用 UnitPost 创建，并把返回的 SPF / DKIM / MAIL FROM 记录写进 `dnsRecordsJson`。

发信要求 `status` 为 `verified` 或 `degraded`（degraded 仍可发，适配器按 verified 处理）；`failed` 不可发。

### 2.3 开启收件（必须手工确认）

收件默认关闭，且必须用**独立子域**（例如 `inbox.example.com`）：

1. UnitPost 控制台 → 域名 → Receiving → 开启；或
   `PATCH /api/v1/email/domains/{id}`，body `{ "capabilities": { "receiving": "enabled" } }`。
2. 把返回的 `receiving.record`（MX）发布到 DNS。域名本身已有 MX 时不要开收件，否则会把整个域的邮件导走。
3. 回后台点「验证」，看到 MX 记录后确认 `receiving.status = verified`。

适配器会把 `receiving.record` 合并进域名 DNS 列表，方便对照。

### 2.4 Webhook

UnitPost 控制台 → Webhooks → 新建：

- URL：`https://<你的域名>/api/webhooks/unitpost/<endpointId>`
  `<endpointId>` 先在后台「服务商 → 收件 Webhook」创建端点，复制页面生成的地址。
- 事件：`email.received`，以及 `email.sent` / `email.delivered` / `email.bounced` / `email.complained` / `email.failed` / `email.suppressed` / `email.delivery_delayed`。
- Signing Secret：形如 `whsec_...`，粘回端点。

可选：端点开启 `include_text` 后，`email.received` 会额外带 64KB 纯文本；本站仍然以 `GET /email/received/{id}` 为准。

## 3. 验签

UnitPost 使用 Svix 方案：

- 头：`svix-id`、`svix-timestamp`、`svix-signature`（`v1,<base64>`，可能多个空格分隔）。
- 签名串：`${svix-id}.${svix-timestamp}.${rawBody}`，HMAC-SHA256，base64。
- 时间窗 ±5 分钟；必须用原始请求体验签。
- 密钥 `whsec_<base64>`：适配器会同时尝试原文与 base64 解码后的 key，兼容两种实现。

去重优先用 body 里的 `event_id`（同一事件多次投递不变），缺失时退回 `svix-id`。

## 4. 发件规则

- `from` 只接受已验证域名；`to` / `cc` / `bcc` 各最多 50 个。
- 幂等：`Idempotency-Key` = `send/{mailboxId}/{uuid}`，24 小时内同 key 同 body 返回首次结果。
- 附件：base64（`content`），`content_type` / `content_id` 可选，单请求最多 20 个。
- 收件人是 `example.com` / `example.net` / `example.org` 时会被服务商直接剔除，测试请用真实邮箱。
- 响应 `status` 只有 `queued` / `scheduled`；`scheduled` 在本站按 `queued` 记录。

## 5. 收件流程

1. 验签 → 归一化事件（`email.received` → `kind: 'inbound'`）。
2. 以 `providerMessageId` 去重（`webhook_event` 端点 + 事件 ID 唯一）。
3. 按 `to` 反查 `mailbox`；未命中写 `unrouted_message(unknown)`，临时邮箱过期写 `expired`，均返回 200。
4. 调 `GET /email/received/{id}` 取 `html` / `text` / `headers` / 附件元数据。
5. 净化 HTML 后入库；临时邮箱在考察期内收到首封 → 永久保留。

## 6. 已知限制

| 限制               | 说明                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| 收件要单独开启     | 不开 Receiving 就不会有 `email.received`；开启会接管该名字的全部 MX，务必用子域 |
| Webhook 默认无正文 | 每次多一次 API 调用；`include_text` 只能补纯文本                                |
| 附件只有元数据     | 下载要走签名 URL（约 5 分钟过期），本站暂不代下载                               |
| degraded 状态      | 仍可发信，但记录漂移；后台会显示为 verified，需在控制台看细节                   |
| 删除域名不可逆     | 后台删除只删本地记录，UnitPost 侧需自行处理                                     |
