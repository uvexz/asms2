# Resend 接入

## 1. 边界

Resend 是这套适配层最早对接的一家，也是唯一用官方 SDK 的（其余六家都是手写 HTTP）。代码在 `src/server/providers/resend.ts`：

- 发件：`POST /emails`，`from` 必须是该账号下已验证的域名。
- 收件：域名 MX 指向 Resend，它收下后推 `email.received`；**Webhook 只有元数据**，正文得再调 Receiving API 拉一次。
- `custom` 那一档复用这份实现，只换基地址，用来接自建的 Resend 协议网关。
- 边界上的事（为什么没有 SMTP/IMAP、为什么退不了信）在 [architecture.md](../architecture.md#1-定位与边界)，这里不重复。

## 2. 接入步骤

### 2.1 API Key

Resend 控制台 → API Keys → 创建。需要：

- 发件权限（`emails.send`）
- 收件读取权限（`emails.receiving`）
- 域名管理权限（`domains.*`，用于自动创建域名）

把 Key 填入「管理后台 → 服务商」。Key 会以 AES-256-GCM 加密存储，界面只显示末四位。

### 2.2 域名

建议使用子域，例如 `mail.example.com` 或 `temp.example.com`：

- 避免与根域已有的企业邮箱 MX 冲突；
- 长期域与临时域分开，降低临时邮箱被滥用后的信誉影响。

在「管理后台 → 域名」点「添加域名」，系统会调用 Resend API 创建并返回 DNS 记录。

**DNS 要点**

| 记录 | 要求                                                    |
| ---- | ------------------------------------------------------- |
| MX   | 指向 Resend 提供的主机，优先级 **10**（数字最小者优先） |
| SPF  | TXT，按控制台给的值                                     |
| DKIM | CNAME（`resend._domainkey.…`）                          |

根域如果已经有 MX（Google Workspace / 企业邮），**必须用子域**，否则整个域的邮件都会被导到 Resend。

配置完成后回后台点「验证」，状态变为 `verified` 才能开启收发。

### 2.3 Webhook

Resend 控制台 → Webhooks → 添加：

- URL：`https://<你的域名>/api/webhooks/resend/<endpointId>`
  `<endpointId>` 先在后台「服务商 → 收件 Webhook」创建端点，复制页面上的 URL。
- 事件：
  - 必须：`email.received`
  - 建议：`email.sent`、`email.delivered`、`email.bounced`、`email.complained`、`email.failed`、`email.delivery_delayed`
- Signing Secret：形如 `whsec_...`，复制回端点的「签名密钥」。

端点 URL 带一段不可猜的 ID，且每个事件都会验签；两者缺一不可。

### 2.4 验证闭环

1. 给任一邮箱发一封信，`/mail` 应在 20 秒内出现（列表轮询 20s）。
2. 用该邮箱向 `delivered@resend.dev` 发信，状态应变为 `delivered`。
3. 后台「日志 → Webhook」应能看到 `email.received` 与投递事件。

## 3. 发件规则

- `from` 域名必须与已验证域名**完全一致**；验证了 `send.example.com` 不能用 `example.com` 发。
- 默认的 `onboarding@resend.dev` 只能发给账号邮箱，生产必须用自有域名。
- 速率:Resend 默认约 **2 req/s**;429/408 返回 `provider_retryable`,退款后用同一幂等键重试,不要新建幂等键。
- 附件：单封 ≤10MB、≤3 个（本项目限制），base64 传输；批量接口不支持附件。
- 幂等：每封带 `idempotencyKey = send/{mailboxId}/{uuid}`，避免重试造成重复投递。
- SDK 不抛异常而是返回 `{ data, error }`，服务层已统一转成 `ProviderError`。

## 4. 收件机制

Webhook 载荷只有元数据：

```json
{
  "type": "email.received",
  "data": {
    "email_id": "...",
    "from": "Alice <alice@example.com>",
    "to": ["hello@mail.example.com"],
    "subject": "...",
    "attachments": [{ "id": "...", "filename": "a.pdf" }]
  }
}
```

处理流程：

1. 用端点密钥验签（svix 头，时间窗 ±5 分钟）。
2. 以 `email_id` 做幂等（`webhook_event` 唯一索引）。
3. 按 `to` 找邮箱；找不到写 `unrouted_message`，返回 200。
4. 调 `emails.receiving.get(emailId)` 取 `html/text/headers/attachments`。
5. 净化 HTML 后入库；临时邮箱若仍在考察期，置 `retainedAt` 并清空 `expiresAt`。

失败处理：只有**可恢复错误**才返回 5xx 让 Resend 重试；验签失败返回 401；地址不存在返回 200（否则会无限重试）。

## 5. 已知限制与坑

| 坑                  | 说明                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| Webhook 是团队级的  | 同团队其他应用的 webhook 也会打到本端点；按收件域过滤，非本站直接 `ignored` |
| 无法 SMTP 退信      | 邮件已在 Resend 层收下，地址不存在只能丢弃或落墓碑                          |
| Webhook 不含正文    | 每封多一次 API 调用；要设置超时与重试                                       |
| 套餐限制            | 域名数量、日发量、收件能力受账号套餐影响，超额会 403/429；上线前核对        |
| 附件不在 Webhook 里 | 需要单独调附件接口；当前版本只存元数据，未做代理下载                        |
| 域名删除不可逆      | 后台删除域名只删本地记录；Resend 侧需自行处理                               |

## 6. 排查顺序

1. 域名状态是否 `verified`，DNS 是否生效：`dig MX mail.example.com +short`。
2. Resend 控制台 Emails → Receiving 是否真的有这封信。
3. Webhooks 页面是否触发、响应码是否 200。
4. 本站「日志 → Webhook」是否有记录、是否 `failed`。
5. 「日志 → 未投递」是否有该地址（拼写错误或临时邮箱已过期）。
6. 服务商状态是否被停用、Key 是否过期。
