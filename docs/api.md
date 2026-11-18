# 对外 API

面向脚本与第三方集成。面板本身走 server function，不经过这里。

## 1. 鉴权

在 `/settings` 创建 API Key（只显示一次），请求头二选一：

```
x-api-key: asms_xxx
Authorization: Bearer asms_xxx
```

- Key 以哈希存储，可设置过期时间与限流（默认 120 次/分钟）。
- Key 创建时可绑定 `metadata.mailboxId`：发信会被强制限定到该邮箱，列邮件也会自动过滤。
- Key 失效、被吊销或用户被封禁时返回 401/403。

## 2. 发信

`POST /api/v1/send`

```json
{
  "fromMailboxId": "mb_xxx",
  "to": ["alice@example.com"],
  "cc": [],
  "bcc": [],
  "subject": "Hello",
  "text": "纯文本正文",
  "html": "<p>可选，传了就以 HTML 为准</p>",
  "attachments": [
    { "filename": "a.txt", "content": "base64…", "contentType": "text/plain" }
  ]
}
```

| 字段            | 必填     | 说明                                           |
| --------------- | -------- | ---------------------------------------------- |
| `fromMailboxId` | ✅       | 必须是自己的长期邮箱；Key 绑定了邮箱时可省略   |
| `to`            | ✅       | 字符串或数组，最多 20 个                       |
| `cc` / `bcc`    | —        | 同上                                           |
| `subject`       | —        | 为空时使用 `(无主题)`                          |
| `text` / `html` | 至少一个 | 纯文本会按空行转段落                           |
| `attachments`   | —        | 最多 3 个，单封合计 ≤10MB，`content` 为 base64 |

成功：

```json
{
  "ok": true,
  "data": {
    "id": "msg_x",
    "providerMessageId": "re_x",
    "subject": "Hello",
    "to": ["alice@example.com"]
  }
}
```

约束：

- 临时邮箱默认不能发信。
- 每日配额默认 5 封（按站点时区零点重置），超额返回 429。
- 服务商失败返回 502；明确失败会回滚配额，网络超时不会。

## 3. 读邮件

`GET /api/v1/messages`

| 参数        | 说明                                                   |
| ----------- | ------------------------------------------------------ |
| `id`        | 传了则返回单封详情（含正文与附件元数据）               |
| `folder`    | `inbox`（默认）/ `sent` / `trash` / `spam` / `archive` |
| `mailboxId` | 限定邮箱；Key 绑定邮箱时自动使用                       |
| `q`         | 主题或发件人模糊匹配                                   |
| `cursor`    | 上一页返回的 `nextCursor`                              |
| `limit`     | 1–50，默认 30                                          |

列表响应：

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "msg_x",
        "mailboxAddress": "hello@mail.example.com",
        "direction": "inbound",
        "fromAddress": "alice@example.com",
        "subject": "Hi",
        "snippet": "…",
        "isRead": false,
        "hasAttachments": true,
        "receivedAt": 1795012419000
      }
    ],
    "nextCursor": "1795012419000_msg_x"
  }
}
```

`nextCursor` 为 `null` 表示没有更多。时间为 Unix 毫秒。

## 4. 邮箱

`GET /api/v1/mailboxes` → 自己的邮箱列表（含 `expiresAt`、`retained`、`unreadCount`）。

`POST /api/v1/mailboxes`

```json
{
  "kind": "permanent",
  "localPart": "hello",
  "domainId": "dom_x",
  "displayName": "可选"
}
```

- `kind`：`permanent`（默认）或 `temp`。
- 前缀规则：仅 `[a-z0-9]`，长期 ≥3 位、临时 ≥8 位，上限取站点配置。
- 域名必须已验证、开启接收，且对该类型开启了「允许新建」。
- 长期邮箱受用户配额限制；临时邮箱不限量但有创建频率限制。

## 5. 错误码

统一结构：

```json
{
  "ok": false,
  "error": {
    "code": "quota_exceeded",
    "message": "今日发件额度已用完（5 封/天）"
  }
}
```

| code                    | HTTP | 场景                               |
| ----------------------- | ---- | ---------------------------------- |
| `unauthorized`          | 401  | 缺少/无效 API Key                  |
| `forbidden`             | 403  | 越权、账号被封禁、临时邮箱发信     |
| `validation_failed`     | 400  | 参数不合法（前缀过短、地址格式错） |
| `not_found`             | 404  | 邮箱/邮件不存在或已过期            |
| `address_taken`         | 409  | 地址被占用或仍在冷却期             |
| `mailbox_limit_reached` | 409  | 长期邮箱达上限                     |
| `quota_exceeded`        | 429  | 当日发件额度用尽                   |
| `rate_limited`          | 429  | 频率限制                           |
| `provider_error`        | 502  | 服务商调用失败                     |
| `not_implemented`       | 501  | 服务商能力未接入                   |

## 6. 收件 Webhook（服务商 → 本站）

`POST /api/webhooks/{provider}/{endpointId}`

- 由服务商调用，不使用 API Key；用端点签名密钥验签。
- 幂等键：`(endpointId, providerEventId)`。
- 返回：成功 200；验签失败 401；可恢复错误 5xx（触发重试）；地址不存在等永久错误 200 + 落墓碑。

详见 [providers/resend.md](./providers/resend.md#23-webhook)。
