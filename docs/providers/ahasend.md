# AhaSend 接入

## 1. 边界

AhaSend 是欧盟区事务性邮件服务商，适配器代码在 `src/server/providers/ahasend.ts`：

- 基地址：`https://api.ahasend.com`，所有接口形如 `/v2/accounts/{account_id}/...`。
- **必须配置 Account ID**（账号 UUID）：AhaSend 没有「列出账号」接口，API 路径里必须显式带上，后台服务商表单已加该字段。
- 发件：统一走 `POST /v2/accounts/{account_id}/messages/conversation`。
- 收件：在 AhaSend 控制台配置 Route（MX + 地址匹配），收到 `message.routing` 事件，**正文与附件直接在事件里**。
- 域名：`POST /domains`、`GET /domains/{hostname}`、`POST /domains/{hostname}/check-dns`。

## 2. 接入步骤

### 2.1 API Key 与 Account ID

AhaSend 控制台 → API Keys → 创建 v2 Key，作用域至少：

- `messages:send:all`（或按域名 `messages:send:{domain}`）
- `domains:read` / `domains:write`（自动创建、验证域名）
- 若要用 API 管理 Webhook/Route，再补对应作用域（本站不代建，可省）

填到「管理后台 → 服务商」：类型 `AhaSend`，同时填 **Account ID**（控制台账号设置里的 UUID）。Key 加密存储，只显示末四位。

### 2.2 域名

后台添加域名会调用 `POST /domains`，把 `dns_records` 写入本地记录：

- `dns_valid = true` 视为 `verified`；
- 否则 `pending`；
- 「验证」按钮调用 `check-dns`，再 `GET /domains/{hostname}` 回写状态。

发信要求域名 DNS 全部通过，且域名未被暂停（`paused`）。

### 2.3 收件（Routes）

AhaSend 的入站是独立产品能力，需要在控制台建 Route：

1. 域名 MX 指向 AhaSend（控制台会给具体主机名）。
2. Routes → 新建：匹配 `*@inbox.example.com` 之类的地址模式，Webhook 指向本站端点。
3. 打开「包含附件 / 头」选项，正文与附件才会进 payload。

事件类型是 `message.routing`，签名密钥是 **route secret**（`aha-rsec-...`），不是普通 webhook 的 `aha-whsec-...`；在后台建端点时粘贴对应那个。

### 2.4 Webhook

普通投递事件（`message.delivered` 等）在控制台 Webhooks 里建：

- URL：`https://<你的域名>/api/webhooks/ahasend/<endpointId>`
- 事件：`message.reception`、`message.delivered`、`message.transient_error`、`message.bounced`、`message.failed`、`message.suppressed`
- Secret：`aha-whsec-...`，粘回端点。

## 3. 验签

AhaSend 遵循 Standard Webhooks：

- 头：`webhook-id`、`webhook-timestamp`、`webhook-signature`。
- 签名串：`${webhook-id}.${webhook-timestamp}.${rawBody}`，HMAC-SHA256，base64，`v1,<sig>`，可能多个空格分隔。
- **密钥用原文**（含 `aha-whsec-` / `aha-rsec-` 前缀），不要 base64 解码。
- 时间窗 ±5 分钟；必须用原始请求体。
- 去重使用 `webhook-id`（同一次投递重试不变）；事件本身的 `data.id` 是邮件 ID。

## 4. 发件规则

- 统一用 conversation 接口：`to[]` 原样进 To 头，支持 `cc` / `bcc`，`to + cc + bcc` 合计 ≤ 50。
  单发接口 `messages` 会给每个收件人单独发一封、各自不同 ID，不符合本站「一封邮件一个 ID」的模型。
- 幂等：`Idempotency-Key` = `send/{mailboxId}/{uuid}`，24 小时内可安全重试。
- 附件：`{ base64: true, data, content_type, file_name }`；内联图片的 `content_id` 必须带尖括号，适配器会自动补。
- `reply_to` 只支持单个地址，本站取第一个。
- `message-id` / `to` / `cc` / `reply-to` 等头由参数管理，自定义 headers 里的同名项会被过滤。
- 响应 `data[0].id` 才是消息 ID；`status = error` 时 `error` 字段给出原因。

## 5. 收件流程

1. 验签 → `message.routing` 归一化为 `kind: 'inbound'`。
2. 正文（`html_body` / `plain_body`）、头、附件元数据直接从事件取，**不再回查 API**（AhaSend 没有按 ID 读取路由邮件的接口）。
3. `content_id` / `filename` / `size` 写入 `attachment` 元数据；附件 base64 本体不入库。
4. 按 `to` 反查邮箱，后续与其它服务商一致。

## 6. 已知限制

| 限制                | 说明                                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| 必须手填 Account ID | 路径强依赖；未填时发件/域名接口会直接报 `account_id_missing`           |
| 入站正文随事件      | payload 可能较大（附件 base64），站点只存元数据；30MB 上限由服务商保证 |
| Route 需手工建      | 本站不代建 Route，也不需要 route 管理作用域                            |
| 两类密钥            | 事件用 `aha-whsec-`，入站路由用 `aha-rsec-`，粘错会一直 401            |
| 收件人上限 50       | 超出时适配器直接抛不可重试错误，发件配额会回滚                         |
