# asms2 文档

| 文档                                                 | 内容                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| [architecture.md](./architecture.md)                 | 定位与边界、模块划分、数据模型、权限模型、关键流程、前端方案、安全与关键决策     |
| [deployment.md](./deployment.md)                     | 环境变量、构建运行、Nginx、定时任务、备份回滚、观测与排障                        |
| [providers/resend.md](./providers/resend.md)         | Resend 接入步骤、Webhook 配置、发件规则、限制与排查                              |
| [providers/unitpost.md](./providers/unitpost.md)     | UnitPost 接入：API Key、Receiving 与 MX、Svix 验签、发件规则                     |
| [providers/ahasend.md](./providers/ahasend.md)       | AhaSend 接入：Account ID、Conversation 发件、Routes 收件、Standard Webhooks 验签 |
| [providers/groundmail.md](./providers/groundmail.md) | Groundmail 接入：Resend 兼容发信、入站 MX 与 `Groundmail-Signature` 验签         |
| [providers/mailtrap.md](./providers/mailtrap.md)     | Mailtrap 接入：双基地址、批量 Webhook、`Mailtrap-Signature` 验签、Inbound 收件箱 |
| [providers/plunk.md](./providers/plunk.md)           | Plunk 接入：`/v1/send`、工作流 Webhook、共享密钥头、入站 catch-all               |
| [providers/reloop.md](./providers/reloop.md)         | Reloop 接入：`/api/mail/v1/send`、`t=,v1=` 验签、inbox 回查正文、域名 API        |
| [api.md](./api.md)                                   | 对外 REST API、错误码、限流、Webhook 回调契约                                    |
| [database.md](./database.md)                         | 迁移流程、本地 SQLite 与 Turso、SQL 约束、备份                                   |
| [development.md](./development.md)                   | 目录结构、别名、命令、质量门、改动流程                                           |
| [status.md](./status.md)                             | 已完成范围、已验证链路、未实现项、已知风险                                       |

项目级硬性约定在根目录 [AGENTS.md](../AGENTS.md)，UI 规则也写在里面。

## 从哪看起

刚接手，先读 [architecture.md](./architecture.md) 的「定位与边界」——不理解"为什么不能退信"，后面一半的设计都会看着别扭。接着看 [development.md](./development.md)，跑起来再说。

准备上线就照 [deployment.md](./deployment.md) 的顺序走：环境变量 → 迁移 → 构建 → Nginx → cron，中间不要跳步。

收不到邮件这类问题，八成和某个具体服务商有关，直接翻对应的接入文档，末尾都有排查段；先确认 `dig MX` 指对了地方，再看后台的 Webhook 日志和未投递记录。

要用 API 发信，看 [api.md](./api.md)。
