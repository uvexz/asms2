# Plunk 接入

## 1. 边界

Plunk（[useplunk/plunk](https://github.com/useplunk/plunk)）是「事务邮件 + 联系人 + 工作流」一体的事务性邮件服务，适配器代码在 `src/server/providers/plunk.ts`：

- 基地址：`https://next-api.useplunk.com`（托管版）。**`api.useplunk.com` 已下线并返回 410**，别再填旧域名；自建实例用 `API Base URL` 覆盖。
- 认证：`Authorization: Bearer sk_...`（Secret Key）。`pk_...` 只能调 `/v1/track`，发信会 401。
- 发件：`POST /v1/send`。
- 收件：域名发布入站 MX 后，Plunk 把每一封来信解析成 `email.received` 事件，再由**工作流的 Webhook 步骤**转发出来。**没有「按 ID 拉取入站邮件」的接口**。
- 域名：`POST /domains` 创建、`GET /domains/{id}/verify` 立即验证、`GET /domains/project/current` 列表。

> 与 Resend 协议不兼容：发信字段是 `to` / `subject` / `body`（单字段 HTML）/ `from` / `reply` / `headers` / `attachments`，事件形状与验签方式都不同，所以是独立适配器。

## 2. 接入步骤

### 2.1 API Key

Plunk 控制台 → 项目 → **Settings → API Keys** → 复制 **Secret Key**（`sk_` 开头）。

填到「管理后台 → 服务商」：类型选 `Plunk`，Key 加密存储，界面只显示末四位。自建实例再补 `API Base URL`（如 `https://plunk.example.com`，不带 `/api`）。

> 只有 Secret Key 能调 `/domains`、`/v1/send`；不用填 Account ID。域名接口的请求体里必须带一个 `projectId`（uuid），但服务端实际按 Key 定位项目——适配器在没配 Account ID 时传占位 UUID，不影响结果。

### 2.2 域名（发信）

后台「域名」页添加域名会依次调 `GET /config`（拿 SES 区域）与 `POST /domains`，然后按 Plunk 面板的同一套规则拼出 `dnsRecordsJson`：

| 记录         | 主机                        | 类型  | 值                                       |
| ------------ | --------------------------- | ----- | ---------------------------------------- |
| DKIM ×3      | `{token}._domainkey.<域名>` | CNAME | `{token}.dkim.amazonses.com`             |
| MAIL FROM    | `plunk.<域名>`（子域可配）  | MX    | `feedback-smtp.<SES 区域>.amazonses.com` |
| MAIL FROM    | `plunk.<域名>`              | TXT   | `"v=spf1 include:amazonses.com ~all"`    |
| 入站（可选） | `<域名>`                    | MX    | `inbound-smtp.<SES 区域>.amazonaws.com`  |

- 3 条 DKIM CNAME 是**发信必需**项，缺一条就发不出去。
- `token` 由 Plunk 在创建域名时生成，接口只回 `dkimTokens`，DNS 记录是适配器还原的（Plunk 面板也是这么拼的）。
- 入站 MX 是**可选项**，发布后该名字下的全部来信都归 Plunk。域名已有 MX（Google Workspace / M365）时不要发布，换独立子域（`mail.example.com`）再在上面验证一次。
- Plunk 侧每 5 分钟自动检查一次 DNS；本站点「验证」会调 `GET /domains/{id}/verify` 立刻跑一次，再读 `GET /domains/project/current` 回写状态。`verified` 为真才算 `verified`，否则 `pending`。

### 2.3 收件

入站是 catch-all：域名下**任意地址**的来信都进同一个事件，由本站按 `to` 反查邮箱路由，正好匹配「一个域名下多个邮箱」的模型。

1. 先按 2.2 让域名**发信验证通过**——Plunk 只在完全验证的域名上处理入站 MX。
2. 在 DNS 发布 `MX <域名> → inbound-smtp.<SES 区域>.amazonaws.com`（优先级 10）。
3. 用外部邮箱给 `anything@<你的域名>` 发一封信，确认 Plunk 的 Activity 里出现一条 **Inbound** 记录（此时邮件已入库，但还没到本站）。

> 同一域名在多个项目里验证时，**每个项目都会收到一份**入站事件；本站按 `messageId` 去重，不会重复入库。

### 2.4 Webhook（工作流）

Plunk 的 Webhook 不是「服务商后台的端点列表」，而是**工作流里的一个步骤**：一个触发事件对应一个工作流。

1. 后台「服务商 → 收件 Webhook」先建端点，拿到地址：
   `https://<你的域名>/api/webhooks/plunk/<endpointId>`，并记下填的签名密钥。
2. Plunk 控制台 → **Workflows** → 新建，触发器选 `email.received`。
3. 加一个 **Webhook** 步骤：
   - URL：上面的端点地址
   - Method：`POST`
   - Headers：`{"X-Plunk-Secret": "<与端点一致的密钥>"}`
   - Body：**留空**（用默认载荷，正文在 `event.body` 里）
4. 启用工作流（新建的工作流默认是停用的）。

投递状态事件各建一个工作流，同样加 Webhook 步骤指向同一个端点：`email.sent` / `email.delivery` / `email.bounce` / `email.complaint`。`email.open` / `email.click` / 联系人 / 自定义事件不需要订阅，适配器会记 `ignored`。

> 不需要额外过滤：Plunk 会把该项目的全部事件都推过来，本站按 `emailId` 找不到对应发件记录时只写一条 `ignored`。

## 3. 验签

Plunk 的 Webhook 步骤**没有 HMAC 签名**，只能用自定义请求头带一个共享密钥，所以这一层是「常量时间比对」而不是签名校验：

- 接受三种头：`X-Plunk-Secret`（推荐）、`X-Plunk-Signature`、`X-Webhook-Secret`，或 `Authorization: Bearer <密钥>`。
- 头缺失或值不匹配一律 **401**，不写事件表。
- 密钥按原文比较，不做 base64 / hex 解码。
- 请求体不是合法 JSON → **400**（避免 Plunk 重试坏载荷）。

去重键：`execution.id`（工作流执行 ID，每次触发唯一）＋事件类型；载荷里没有 `execution` 时退回 `类型:emailId`，再退回原始载荷的 SHA-256 前 32 位。

> 事件名**不会**出现在载荷里（Webhook 步骤只转发触发事件的数据），适配器按字段反推：

| 判定顺序 | 特征字段                                            | 事件               |
| -------- | --------------------------------------------------- | ------------------ |
| 1        | `bouncedAt` / `bounceType`                          | `email.bounce`     |
| 2        | `complainedAt` / `complaintFeedbackType`            | `email.complaint`  |
| 3        | `deliveredAt`                                       | `email.delivery`   |
| 4        | `openedAt`                                          | `email.open`       |
| 5        | `clickedAt`                                         | `email.click`      |
| 6        | `sentAt`                                            | `email.sent`       |
| 7        | `recipients` / `body` / `fromHeader` / `hasContent` | `email.received`   |
| 8        | `reason`                                            | 联系人退订（忽略） |

## 4. 发件规则

- **不支持 cc / bcc**：`/v1/send` 只有 `to`。适配器遇到非空 `cc` / `bcc` 直接抛不可重试错误（`unsupported_feature`），而不是静默并进 `to`——那样会泄露密送对象。
- `from` 用 `{ email, name }` 对象；域名必须是已验证状态，否则 Plunk 回 422。
- `body` 必填且是 HTML；只有 `text` 时适配器会转义并包成段落（`<div><p>…</p></div>`）。
- `reply` 只接受**单个**地址，取 `replyTo[0]`。
- 附件：`{ filename, content(base64), contentType, contentId?, disposition }`；`contentType` 必填，本站缺省填 `application/octet-stream`；有 `contentId` 时按内联处理。Plunk 默认上限 10 个 / 10MB，整封 40MB。
- 幂等：带 `Idempotency-Key`（本站用 `send/{mailboxId}/{uuid}`）。同 key 第二次请求 Plunk 回 **409**，适配器按不可重试错误透出。
- 响应 `{ success, data: { emails: [{ contact, email, status }] } }`：**每个收件人一条记录**。本站只保存首个 `email` ID（与 Resend 单 ID 语义一致），因此多收件人时其余收件人的状态事件不会回写。
- `status` 为 `queued` / `scheduled` 都算已受理（`scheduled` 在本站记为 `queued`）；`throttled` 时 `email` 为 `null`，适配器抛 `send_rejected`。

## 5. 收件流程

1. 校验共享密钥 → 解析载荷。默认载荷是 `{ contact, workflow, execution, event }`；若把 Body 配成 `{{event}}`，整个载荷就是事件本身，两种都支持。
2. `providerMessageId` 取 `event.messageId`（SES 消息 ID），`message` 表按它去重。
3. `to` = `event.to` 与 `event.recipients` 的并集（去重、主收件人在前）。Plunk 不区分 To/Cc/Bcc，只给信封收件人列表；全部按 `to` 记录，保证「邮箱只出现在 cc 里」的邮件也能命中。
4. 正文：`event.body` 是「已净化的 HTML，或没有 HTML 时的纯文本」。适配器按首字符 `<` 判断，HTML 进 `html`、否则进 `text`（`ingestInbound` 会再净化和转文本）。
5. 没有附件、没有原始头、没有 `In-Reply-To`/`References`：`hasAttachments` 恒为 false，线程归并退回「发件人 + 主题」。
6. `getInbound` 直接抛 `not_implemented` —— Plunk 不存原始 MIME，也没有取件接口。正常路径不会走到它，因为入站事件总是自带正文与收件人。

发件事件映射：

| 事件                                           | 本地 `message.status`                               |
| ---------------------------------------------- | --------------------------------------------------- |
| `email.sent`                                   | `sent`                                              |
| `email.delivery`                               | `delivered`                                         |
| `email.bounce`                                 | 永久退信 `bounced`；软退信 `sent`（Plunk 仍会重试） |
| `email.complaint`                              | `complained`                                        |
| `email.open` / `email.click` / 联系人 / 自定义 | 记 `ignored`                                        |

## 6. 已知限制

| 限制                     | 说明                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| 发信不支持 cc / bcc      | `/v1/send` 无对应字段，适配器直接拒绝                                |
| 入站无附件               | Plunk 在解析阶段丢弃附件，本站只能记录「无附件」                     |
| 入站无原始头             | 不保留 `Message-ID` / `In-Reply-To` / `References`，线程归并精度下降 |
| 入站正文可能是纯文本     | 无 HTML 部分时 `body` 是纯文本，按首字符判断                         |
| 只有共享密钥，没有签名   | 需要在工作流 Webhook 步骤里手工加 `X-Plunk-Secret` 头                |
| 事件名不在载荷里         | 靠字段反推事件类型（见表）；新增事件类型需要补 `inferEventType`      |
| 每个事件一个工作流       | 状态与收件各建一个工作流；漏建就只有站内状态没有回写                 |
| Webhook 不重试           | 超时 10 秒、非 2xx 即步骤失败；本站失败会返回 5xx，但 Plunk 不会重投 |
| 多收件人只跟踪首个 ID    | 每人一条 `email` 记录，其余收件人的状态事件不会命中                  |
| 入站计入 Plunk 配额      | 达到 `Billing → Limits` 的入站上限后，Plunk 静默丢弃，本站收不到     |
| 域名接口要占位 projectId | 请求体必须带 uuid，实际按 Key 定位项目；配了 Account ID 就用它       |

## 7. 排查

- **发信 422 `Could not parse sender email`**：`from` 域名没在 Plunk 验证，或 Key 属于别的项目。
- **发信 403 / 401**：Key 填成了 `pk_`，或项目被停用。
- **收不到信**：`dig MX <域名>` 确认入站 MX 已生效；确认域名发信已验证（Plunk 只在完全验证的域名上处理入站）；确认 `email.received` 工作流**已启用**且 Webhook 步骤的 Body 留空。
- **Webhook 401**：端点密钥与工作流 Headers 里的 `X-Plunk-Secret` 不一致，或漏了这个头。
- **Activity 有 Inbound 但本站没入库**：看「管理后台 → 日志 → Webhook 事件」，`ignored` 说明载荷里没有 `messageId`/收件人；`failed` 看错误列。
