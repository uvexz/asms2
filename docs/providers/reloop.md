# Reloop 接入

## 1. 边界

Reloop（[reloop.sh](https://reloop.sh)）是「事务邮件 + 营销 + 收件箱」一体化服务，适配器代码在 `src/server/providers/reloop.ts`：

- 基地址：`https://reloop.sh`，接口路径统一带 `/api`（如 `/api/mail/v1/send`）。
- 认证：`x-api-key: rl_...`（不是 `Authorization: Bearer`）。
- 发件：`POST /api/mail/v1/send`。
- 收件：域名开启 receiving 并发布 Reloop 给的 MX 后，`email.received` 事件只带信封与元数据，**正文要用 `email_id` 调 `GET /api/inbox/v1/messages/{id}` 回查**。
- 域名：`POST /api/domain/v1/create`、`GET /api/domain/v1/{id}`、`POST /api/domain/v1/verify/{id}`。

> 两套字段风格要分清：**Webhook 载荷是 snake_case**（`email_id`、`created_at`），**REST 响应是 camelCase**（`htmlBody`、`dnsRecords`）。适配器在边界处归一，业务层看不到差异。

## 2. 接入步骤

### 2.1 API Key

Reloop 控制台 → **API Keys** → 新建，复制 `rl_` 开头的 Key（只显示一次）。

填到「管理后台 → 服务商」：类型选 `Reloop`，Key 加密存储，界面只显示末四位。不用填 Account ID。

### 2.2 域名（发信）

后台「域名」页添加域名会调 `POST /api/domain/v1/create`，请求体固定带 `sending_email: true` 与 `receiving_email: true`，返回的 `dnsRecords[]` 直接落进 `dnsRecordsJson`：

| 记录          | 主机                               | 类型        | 值                                      |
| ------------- | ---------------------------------- | ----------- | --------------------------------------- |
| 所有权 / DKIM | 由接口返回（`name` 字段）          | TXT / CNAME | 由接口返回                              |
| MAIL FROM     | `inbound.<域名>` 或接口给的子域    | MX / TXT    | `feedback-smtp.<区域>.amazonses.com` 等 |
| 收件          | 接口返回 `purpose=receiving` 的 MX | MX          | 通常是 `inbound.reloop.sh`（优先级 10） |

- 记录不靠适配器拼，全部来自接口，和 Reloop 面板「Domain → DNS Records」一致。
- 发信要求域名 `status=active`；`pending` / `verifying` 都会被本站记为 `pending`，`failed` / `suspended` 记为 `failed`。
- 后台「验证」会调 `POST /api/domain/v1/verify/{id}`，接口只回 `verifying`，**DNS 检查是异步的**。后台紧接着的 `GET` 可能仍是 `pending`，过十几秒再点一次即可（或等 Reloop 自动检查）。
- 域名已有 MX（Google Workspace / M365）时不要在根域发布收件 MX，换独立子域（`mail.example.com`）再验证一次。

### 2.3 收件

1. 按 2.2 让域名 `active`（收件与发信一起开启）。
2. DNS 发布 `purpose=receiving` 的那条 MX。
3. Reloop 控制台 → **Webhooks** → 新建端点，URL 填本站端点，事件至少勾 `email.received`；要回写发件状态再勾 `email.sent` / `email.delivered` / `email.bounced` / `email.failed` / `email.complained` / `email.delivery_delayed`。
4. 记下端点详情里的签名密钥（`whsec_...`），填到本站「服务商 → 收件 Webhook」。
5. 用外部邮箱给 `anything@<你的域名>` 发一封信，Reloop 面板的 Inbox 里应出现记录，本站随后收到 `email.received`。

> 收件箱按 mailbox 归档（事件里带 `mailbox_id`）。Reloop 是否对任意收件人自动建档取决于账号配置；如果面板里能看到 Inbox 记录、本站却收不到，先查 Webhook 是否订阅了 `email.received`。

### 2.4 Webhook

本站端点地址：`https://<你的域名>/api/webhooks/reloop/<endpointId>`。

Reloop 的 Webhook 是**账号级端点**（不是工作流），一个端点可以同时订阅全部事件；本站按事件类型分派，未订阅的类型也不影响已有逻辑：

- `email.received` → 归一为入站，交给 `ingestInbound`。
- `email.*` 投递状态 → 回写 `message.status`。
- `email.opened` / `email.clicked` / `domain.*` / `contact.*` / `api-key.*` → 记 `ignored`。

## 3. 验签

`Reloop-Signature` 是 `t=<秒级时间戳>,v1=<hex HMAC>`，签名串为 **`${timestamp}.${rawBody}`**，HMAC-SHA256，密钥是端点密钥 `whsec_...` **原文**（不像 Svix 那样 base64 解码）。

- 时间戳优先取 `Reloop-Timestamp` 头，缺失时从签名串的 `t=` 解析；与当前时间相差超过 300 秒 → **401**。
- 比较采用 hex 解码后的常量时间比较；同一事件重投可能带多个 `v1=`，任意一个匹配即通过。
- `Reloop-Id`（`whev_...`）与载荷 `id` 相同，用作去重键；两者都缺时退回载荷 SHA-256。
- 缺签名头、密钥未配置、载荷非法 JSON 分别返回 401 / 401 / 400，不写事件表。

> 与 Standard Webhooks（`webhook-id` / `webhook-signature: v1,<base64>`）**不兼容**，所以没有复用 `signature.ts`。

## 4. 发件规则

- `from` / `to` / `cc` / `bcc` / `reply_to` 都是字符串或字符串数组，显示名写成 `Name <a@b.com>`（适配器用 `formatAddress` 拼）。
- **每个字段最多 50 个收件人**，超出时适配器提前抛不可重试错误（`too_many_recipients`）。
- `html` / `text` 至少给一个，否则抛 `invalid_payload`。
- 附件：`{ filename, content(base64), content_type, content_id? }`；本站缺省 `content_type=application/octet-stream`，`content_id` 去掉尖括号。
- 幂等：带 `Idempotency-Key`（本站用 `send/{mailboxId}/{uuid}`）。官方规定同 key 同 body 重放原响应（响应头 `Idempotent-Replayed: true`），同 key 换 body 回 **422**。
- 响应 `{ success, id, messageId, status, timestamp }`：
  - `id` 是 **email log ID**，webhook 里的 `email_id` 就是它，本站存为 `providerMessageId`；
  - `messageId` 是 MIME Message-ID，仅作兜底；
  - `status=scheduled` 记为 `queued`，其余记为 `sent`。

## 5. 收件流程

1. 验签 → 解析信封：`providerMessageId = data.email_id`（`in_...`），`to = data.to`，`cc = data.cc`，`from` 组装 `from_name <from>`。
2. 事件**不带正文**，`ingestInbound` 会用 `email_id` 调 `GET /api/inbox/v1/messages/{id}`：
   - `htmlBody` → `html`，`textBody` → `text`；
   - `headers` 对象转小写；`messageId` 补进 `message-id`（线程归并、`internetMessageId` 都靠它）；
   - `attachments[]`（`id` / `filename` / `contentType` / `size` / `contentId`）→ 附件元数据；
   - `date` / `createdAt` → 收件时间。
3. 回查失败会抛错 → 本站返回 5xx → Reloop 按 `立即 / 5s / 5min / 30min / 2h / 5h / 10h` 重试（最多 7 次）。
4. 附件只存元数据，正文与附件内容不回传本站（与其它服务商一致）。

发件事件映射：

| 事件                             | 本地 `message.status`                             |
| -------------------------------- | ------------------------------------------------- |
| `email.sent`                     | `sent`                                            |
| `email.delivery_delayed`         | `sent`（服务商仍会重试）                          |
| `email.delivered`                | `delivered`                                       |
| `email.bounced`                  | `bounced`                                         |
| `email.failed`                   | `failed`                                          |
| `email.complained`               | `complained`                                      |
| `email.suppressed`               | `suppressed`（事件目录已有，Reloop 管线暂未接通） |
| `email.opened` / `email.clicked` | `ignored`                                         |

## 6. 已知限制

| 限制                       | 说明                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| 收件要二次回查             | 事件只有信封，正文靠 `GET /api/inbox/v1/messages/{id}`，比「事件自带正文」多一次请求     |
| 回查时机敏感               | 事件先到、inbox 记录未落库时回查可能 404/空；本站返回 5xx 交给 Reloop 重试               |
| 域名验证是异步的           | `verify` 只回 `verifying`，需要稍后再读一次状态                                          |
| 收件按 mailbox 归档        | 事件带 `mailbox_id`；任意地址能否收信取决于 Reloop 账号的收件配置                        |
| 每字段 50 个收件人         | `to` / `cc` / `bcc` 各自上限，超出直接 400                                               |
| 发件状态靠 `id` 匹配       | 若 Reloop 后续把 `email_id` 改成 `messageId`，状态回写会失效，需要改 `send()` 的取值顺序 |
| 签名不是 Standard Webhooks | 自定义 `t=,v1=` 格式，密钥原文参与 HMAC                                                  |

## 7. 排查

- **发信 401 / 403**：Key 填错或不是 `rl_` 开头的账号 Key；403 还可能是 Key 不属于任何组织。
- **发信 400**：域名未 `active`，或 `from` 用了未验证域名；错误体的 `why` / `fix` 会拼进本站错误提示。
- **发信 402 / 429**：配额超限 / 限流，前者不可重试，后者本站按可重试处理。
- **收不到信**：`dig MX <域名>` 确认 `purpose=receiving` 的 MX 已生效；确认域名 `active`；确认 Webhook 订阅了 `email.received`；再看 Reloop 面板 Inbox 是否有记录。
- **Webhook 401**：密钥不是端点详情里的 `whsec_...`，或中间层改写了请求体（签名必须用原始 body）。
- **本站没入库**：看「管理后台 → 日志 → Webhook 事件」——`ignored` 说明事件类型未映射，`failed` 看错误列（多为回查正文失败）。
