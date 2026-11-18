# asms2 文档

| 文档                                                 | 内容                                                                             | 读者            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- | --------------- |
| [architecture.md](./architecture.md)                 | 定位与边界、模块划分、数据模型、权限模型、关键流程、前端方案、安全与关键决策     | 开发者 / 维护者 |
| [deployment.md](./deployment.md)                     | 环境变量、构建运行、Nginx、定时任务、备份回滚、观测与排障                        | 运维 / 部署     |
| [providers/resend.md](./providers/resend.md)         | Resend 接入步骤、Webhook 配置、发件规则、限制与排查                              | 首次接入        |
| [providers/unitpost.md](./providers/unitpost.md)     | UnitPost 接入：API Key、Receiving 与 MX、Svix 验签、发件规则                     | 首次接入        |
| [providers/ahasend.md](./providers/ahasend.md)       | AhaSend 接入：Account ID、Conversation 发件、Routes 收件、Standard Webhooks 验签 | 首次接入        |
| [providers/groundmail.md](./providers/groundmail.md) | Groundmail 接入：Resend 兼容发信、入站 MX 与 `Groundmail-Signature` 验签         | 首次接入        |
| [providers/mailtrap.md](./providers/mailtrap.md)     | Mailtrap 接入：双基地址、批量 Webhook、`Mailtrap-Signature` 验签、Inbound 收件箱 | 首次接入        |
| [providers/plunk.md](./providers/plunk.md)           | Plunk 接入：`/v1/send`、工作流 Webhook、共享密钥头、入站 catch-all               | 首次接入        |
| [providers/reloop.md](./providers/reloop.md)         | Reloop 接入：`/api/mail/v1/send`、`t=,v1=` 验签、inbox 回查正文、域名 API        | 首次接入        |
| [api.md](./api.md)                                   | 对外 REST API、错误码、限流、Webhook 回调契约                                    | 集成方          |
| [database.md](./database.md)                         | 迁移流程、本地 SQLite 与 Turso、SQL 约束、备份                                   | 开发者 / 运维   |
| [development.md](./development.md)                   | 目录结构、别名、命令、质量门、改动流程                                           | 开发者          |
| [status.md](./status.md)                             | 已完成范围、已验证链路、未实现项、已知风险                                       | 所有人          |

项目级硬性约定见根目录 [AGENTS.md](../AGENTS.md)；UI 组件规范见其中的 BoardUI 规则块。

## 快速导航

- 刚接手项目：先读 [architecture.md](./architecture.md) 的「定位与边界」，再看 [development.md](./development.md)。
- 要上线：直接看 [deployment.md](./deployment.md)，按顺序配环境变量 → 迁移 → 构建 → Nginx → cron。
- 收不到邮件：先看对应服务商的接入文档（[resend](./providers/resend.md) / [unitpost](./providers/unitpost.md) / [ahasend](./providers/ahasend.md) / [groundmail](./providers/groundmail.md) / [mailtrap](./providers/mailtrap.md) / [plunk](./providers/plunk.md) / [reloop](./providers/reloop.md)）的排查段。
- 要用 API 发信：看 [api.md](./api.md)。
