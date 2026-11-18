# Mailtrap 接入

## 1. 边界

Mailtrap 的收发是两套独立 API，适配器代码在 `src/server/providers/mailtrap.ts`：

- 发信：`POST https://send.api.mailtrap.io/api/send`，`Authorization: Bearer <token>`。
- 收件 / 域名：`https://mailtrap.io/api/*`（`/api/inbound/...`、`/api/domains/...`）。
- 因此 `API Base URL` 只覆盖**管理侧**（收件与域名）；发信地址固定，避免把 `/api/send` 拼到 `mailtrap.io` 上。
- 不需要 Account ID：用到的都是 `/api/domains` 与 `/api/inbound/inboxes/{inbox_id}/...`，路径里不带账号 ID。

> 与 Resend 协议不兼容：发信字段形状不同（`from` 必须是对象、`reply_to` 单个对象、附件用 `content`/`filename`/`type`），验签是 `Mailtrap-Signature` 而非 Svix，所以是独立适配器。

## 2. 接入步骤

### 2.1 API Token

Mailtrap 控制台 → Settings → API Tokens → 创建 Token，至少需要：

- 发信权限（Email Sending）
- 收件读取权限（Inbound）
- 域名读写权限（自动创建 / 刷新域名）

填到「管理后台 → 服务商」：类型选 `Mailtrap`，Token 加密存储，界面只显示末四位。

### 2.2 域名（发信）

后台添加域名会调用 `POST /api/domains`，body `{ "domain": { "domain_name": "example.com" } }`，把返回的 `dns_records` 写进 `dnsRecordsJson`：

- `spf`（TXT）、`dkim1` / `dkim2`（CNAME）、`dmarc`（TXT）是发信必需项；
- 记录上的 `key` 会作为标签展示，`status` 是 `pass` / `fail` / `unchecked` / `missing` / `softfail` / `network_error` 原样透出。

状态映射：

| Mailtrap 状态                                          | 本地 `domain.status` |
| ------------------------------------------------------ | -------------------- |
| `dns_verified = true` 且 `compliance_status=compliant` | `verified`           |
| `non_compliant` / `suspended` / `demo_exhausted`       | `failed`             |
| 其余（DNS 未过、合规审核中、缺公司信息等）             | `pending`            |

**Mailtrap 没有「立即验证」接口**：`GET /api/domains/{id}` 本身会重新跑一遍 DNS 检查。后台「验证」按钮因此只做刷新，不会抛错——这样管理员能看到具体哪条记录没过。

> 域名 DNS 通过后 Mailtrap 还会做合规审核（通常几分钟）。审核未到 `compliant` 前，本地保持 `pending`，发信会被拦下，这是预期行为，不是配置错误。

### 2.3 收件（Inbound 收件箱）

Mailtrap 的入站是 catch-all 模式，一个域名只能挂一个收件箱，正好匹配本站「一个域名下多个邮箱」的模型：

1. Mailtrap 控制台 → Inbound → 新建 folder，再在 folder 里新建 inbox。
2. 创建时选择 **custom domain**（传 `domain_id`，即 2.2 里那个发送域名的 ID）。inbox 地址会显示为 `*@your-domain.com`。
3. 发布返回的 MX（`inbound_mx` 记录）：`<你的域名> MX ...`。域名已有 MX（Google Workspace / M365）时**不要**开，换独立子域。
4. 也可以在控制台打开域名的 `inbound_enabled`（`PATCH /api/domains/{id}`，body `{ "domain": { "inbound_enabled": true } }`），刷新域名后 DNS 列表里会出现 `inbound_mx`。

适配器**不会**在建域名时自动开入站 —— 开入站要改 MX，会接管该名字下的全部邮件，交给管理员显式确认（与 Groundmail 一致）。

### 2.4 Webhook

Mailtrap 的入站事件与发信事件是两类 Webhook，但都指向同一个本站端点：

- URL：`https://<你的域名>/api/webhooks/mailtrap/<endpointId>`
- 收件：类型选 **Inbound Inboxes**，选中 2.3 建的收件箱。
- 投递状态：类型选 **Email Sending**，订阅 `delivery` / `bounce` / `soft bounce` / `spam` / `suspension` / `reject`。
- Secret：Webhook 详情里的 signing secret（32 位十六进制），**原文**粘回端点，不要解码。

Webhook 是**批量推送**：Mailtrap 把约 30 秒内的事件合成一个 `{ "events": [...] }`（最多 500 条）再发。适配器按事件逐条去重处理，同一批里部分失败会返回 5xx，Mailtrap 重投时已处理的事件会被去重键挡掉。

## 3. 验签

- 头：`Mailtrap-Signature`，**没有**时间戳、没有前缀。
- 签名：`HMAC-SHA256(原始请求体)` 的小写十六进制，密钥用 32 位 secret **原文**（不做 hex 解码）。
- 必须用原始请求体；解析后再序列化必然对不上。
- 比较用 `timingSafeEqual`；失败直接 401，不写事件表。
- 重投：失败每 5 分钟一次，最多 40 次；期间 webhook 可能被暂停，需在控制台重新启用。

## 4. 发件规则

- `from` / `to` / `cc` / `bcc` 都是 `{ email, name? }` 对象；`reply_to` 只支持**单个**对象，本站取第一个。
- `text` 与 `html` 至少一项非空，否则适配器直接抛不可重试错误。
- 附件：`{ content(base64), filename, type(MIME), disposition, content_id? }`；有 `content_id` 时按内联处理。
- 幂等：Mailtrap **不支持** `Idempotency-Key`，网络超时后重试可能导致重复投递；本地仍按 `send/{mailboxId}/{uuid}` 记账，但不发给服务商。
- 响应 `{ success, message_ids: [...] }`：**每个收件人一个 ID**。本站只保存首个 ID（与 Resend 单 ID 语义一致），因此多收件人时另外几个收件人的投递状态不会回写。
- 沙箱（Sandbox）是测试产品，走 `sandbox.api.mailtrap.io`，本站不接；这里用的是 Live Sending。

## 5. 收件流程

1. 验签 → 解析 `events[]`，`inbound.message_received` 归一化为 `kind: 'inbound'`。
2. **事件里没有收件人**，只有 `inbox_id` / `message_id` / `from` / `timestamp`；`to` / 主题 / 正文都要回查。
3. 消息 ID 编码为 `inboxId:messageId` —— 取件接口 `/api/inbound/inboxes/{inbox_id}/messages/{id}` 必须带 inbox，而库里只存一个字符串。
4. `ingestInbound` 发现 `to` 为空时**先回查正文再路由**，用的是 `getInbound` 返回的 `to`；这是 Mailtrap 的通用路径，其它服务商不受影响。
5. 正文取 `html_body` / `text_body`；头由 `headers`（已小写）加 `rfc_message_id` / `in_reply_to` / `references` / `reply_to` 补齐，供线程归并。
6. 附件只存元数据（`attachment_id` / `filename` / `content_type` / `size`）；`download_url` 是 1 小时有效的 S3 签名链接，不入库。

发信事件映射：

| Mailtrap 事件                    | 本地 `message.status`       |
| -------------------------------- | --------------------------- |
| `delivery`                       | `delivered`                 |
| `bounce`                         | `bounced`                   |
| `soft bounce`                    | `sent`（Mailtrap 仍会重试） |
| `spam`                           | `complained`                |
| `suspension`                     | `failed`                    |
| `reject`                         | `failed`                    |
| `open` / `click` / `unsubscribe` | 记 `ignored`                |

## 6. 已知限制

| 限制                    | 说明                                                               |
| ----------------------- | ------------------------------------------------------------------ |
| 入站 Webhook 不带收件人 | 每封入站信多一次 API 回查（正文本来也要拉，实际不增加往返）        |
| 批量事件                | 一次请求最多 500 条，`provider.verifyWebhook` 返回数组，逐条去重   |
| 域名只能挂一个收件箱    | catch-all 覆盖该域全部地址；需要多域就一个域一个 inbox             |
| 无幂等键                | 发信超时重试可能重复投递                                           |
| 多收件人只跟踪首个 ID   | Mailtrap 每人一个 `message_id`，其它收件人的状态事件不会命中       |
| 合规审核                | DNS 通过后仍需 Mailtrap 审核到 `compliant`，否则本地保持 `pending` |
| 域名「验证」只是刷新    | Mailtrap 没有独立的 verify 接口                                    |
