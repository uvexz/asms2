# 开发指南

## 1. 环境与命令

```bash
bun install
bun run dev            # http://localhost:3000
bunx tsc --noEmit      # 类型检查（提交前必须过）
bun run build          # 构建，同时生成路由树
bun run db:generate    # 生成迁移
bun run db:migrate     # 应用迁移
bun run lint           # eslint
```

`routeTree.gen.ts` 是生成物，不要手改；新增页面只加文件。

## 2. 目录

```
src/
  components/
    base/ application/  # BoardUI 源码组件（CLI 安装，不手改）
    mail/ admin/        # 业务组合件
  styles/               # theme.css（token）、typography.css、globals.css
  utils/                # cx、directional-icon（BoardUI 约定）
  db/client.ts          # libSQL + Drizzle
  db/schema/            # auth / mailbox / provider / settings / ops
  server/
    auth/               # getAuth 懒加载、requireUser/Admin、API Key 鉴权
    providers/          # MailProvider 接口、resend/custom、unitpost、ahasend、groundmail、mailtrap、plunk、reloop、验签与事件归一
    mail/               # address / mailbox / message / quota / send / content / ingest
    webhooks/process.ts # 验签、去重、分发
    jobs/sweep.ts       # 定时清理
    crypto/secret-box.ts
    fns/                # 面板 server functions
  routes/               # /login /mail /settings /admin/* /api/*
  lib/                  # 客户端查询与格式化
drizzle/                # 迁移（提交）
scripts/seed-demo.ts    # 仅本地演示
```

**别名**：只有 `#/` → `src/`，业务代码与 BoardUI 共用。落盘位置由根目录 `boardui.json` 声明（`components`/`utils`/`styles` 均在 `src/` 下），不要用 `--path` 覆盖。服务端模块不得进入客户端 bundle。

## 3. 依赖方向

```
src/routes / src/components → server/fns → server/{mail,webhooks,jobs} → providers / db
```

- adapter 不读数据库、不读 env；运行时配置由 service 解密后传入。
- 业务层不出现 `if (kind === 'resend')`；新增服务商只改 `providers/`。
- 跨端只走 `createServerFn` 或 `/api/*`。

## 4. 面板 server functions

| 文件           | 主要函数                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fns/site.ts`  | `getPublicSiteFn`、`getPublicLoginConfigFn`、`getSessionFn`                                                                                               |
| `fns/mail.ts`  | `listMailboxesFn`、`createMailboxFn`、`removeMailboxFn`、`listDomainsFn`、`listMessagesFn`、`getMessageFn`、`updateMessageFn`、`sendMailFn`、`getQuotaFn` |
| `fns/admin.ts` | `adminOverviewFn`、站点读写、域名 CRUD/验证、服务商 CRUD、Webhook CRUD、登录配置、用户管理、审计/事件/墓碑查询                                            |

每个函数模样都一样：入参过 zod，首行 `requireVerifiedUser()`（业务能力）、`requireUser()`（仅账号设置）或 `requireAdmin()`，返回 `attempt()` 包过的 `{ ok, data | error }`。不这么写，前端那套 `unwrap()` 就接不住。

## 5. 常见改动

**加一个面板接口**

1. 在 `src/server/fns/<域>.ts` 写 `createServerFn`，首行 `requireVerifiedUser()` / `requireAdmin()`。
2. 用 `attempt()` 包住业务逻辑，返回 `{ ok, data | error }`。
3. 入参用 zod schema `.validator()`。
4. 客户端用 `unwrap()` 调用。

**加一个页面**

1. `src/routes/…` 新建文件；`/admin` 下的页面由 `admin.tsx` 的守卫覆盖。
2. 会话在 root `beforeLoad` 注入 context，子路由用 `Route.useRouteContext()`。
3. UI 先找 `src/components/` 里的 BoardUI 组件。

**加一个服务商**

1. 实现 `MailProvider`（`send` / `getInbound` / `verifyWebhook`，可选域名方法）。
2. 在 `providers/index.ts` 注册，并声明 `capabilities()`。
3. 未实现的调用抛 `ProviderError('not_implemented')`。

**改数据模型**

先看 [database.md](./database.md#2-迁移流程)。三件事别忘：不删列、生成的 SQL 必须自己看一遍、要回填就手写进迁移文件。

## 6. 代码约定

- TypeScript strict + `verbatimModuleSyntax`：类型导入一律 `import type`，留着没用的变量会直接报错。
- 服务端查询必须显式带 `userId`，跨资源操作先校验归属。漏一个就算 bug，不算疏忽。
- 时间存秒，ID 用 nanoid，错误统一抛 `AppError`（带 `code` 和 `status`）。
- 日志里不准出现密钥、完整正文、用户 token。

## 7. UI 约定

- 一律优先使用 `src/components/` 下的 BoardUI 组件；缺组件就 `npx boardui@latest add <name>`，不要手写替代品。
- 只用语义 token（`text-text-primary`、`bg-background-primary-default`）与复合排版类（`text-body-medium`），禁止裸色板与任意 hex。
- 类名合并用 `#/utils/cx`；图标从 `@remixicon/react` 传组件引用。
- 完整规则见根目录 [AGENTS.md](../AGENTS.md) 的 BoardUI 块。

## 8. 质量门

提交前：

- [ ] `bunx tsc --noEmit` 通过
- [ ] `bun run build` 通过
- [ ] 涉及权限/配额/收发的改动，手动跑一次对应链路
- [ ] 没有提交 `.env.local`、`data/*.db`、`.output/`
- [ ] 生产不要执行 `scripts/seed-demo.ts`
