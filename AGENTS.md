<!-- boardui:rules:start -->

# BoardUI design rules

This project uses BoardUI (React + Tailwind CSS v4, source-owned components under `components/`). These rules always apply when writing UI code. MCP tools are on demand; these rules are not optional context.

## Components first

- Before hand-building any UI element, check for an installed BoardUI component under `components/base/` and `components/application/`, and prefer it.
- Missing a component? Install it (BoardUI MCP `install_components`, or `npx boardui@latest add <name>`) instead of writing a lookalike.
- Import through the `@/` alias, e.g. `import { Button } from "@/components/base/buttons/button"`.

## Color: semantic tokens only

- Never use raw palette classes (`text-gray-500`, `bg-white`, `border-neutral-200`) or hex/oklch literals. Every color rides a BoardUI semantic token, which also makes dark mode automatic.
- Text: `text-text-primary`, `text-text-secondary`, `text-text-tertiary`, `text-text-placeholder`, errors `text-text-error-primary`.
- Surfaces: `bg-background-primary-default`, `bg-background-secondary-default` / `-hover`, `bg-background-tertiary-default`, page ground `bg-background-full`.
- Borders: `border-border-button-default` / `-hover`, hairlines `border-separator-border`, tables `border-border-table`, errors `border-border-error-default`.
- Icons: `text-foreground-icon-primary` through `text-foreground-icon-quaternary`.
- Charts: the `chart-1` … `chart-5` tokens (plus `-active` variants). CTAs and selection states: the `accent-50` … `accent-950` ramp.
- Dark mode flips tokens via the `.dark` class on `<html>`. Do not write `dark:` overrides with raw colors; if a token pair looks wrong in dark mode, pick a different token, not a literal.

## Typography: composite utilities only

- Use BoardUI's composite type utilities: `text-title-1-medium`, `text-title-2-medium`, `text-title-3-semibold`, `text-headline-medium`, `text-body-medium`, `text-body-regular`, `text-body-2-*`, `text-caption-1-semibold`, and friends. Each sets size, weight, line-height, and letter-spacing together.
- Never rebuild type by stacking `text-sm font-medium leading-5`; if a style seems missing, look in `styles/typography.css` before inventing one.

## Spacing and shape

- Stay on Tailwind's spacing scale (`gap-2`, `p-4`, `mt-6`); prefer flex/grid `gap` over per-child margins. Arbitrary values (`p-[13px]`) only when matching an existing BoardUI component exactly.
- Cards and panels: `rounded-3xl` with `border-border-button-default`. Inputs and menu rows: `rounded-md` to `rounded-xl`. Pills: `rounded-full`.

## Mechanics

- Direction: wrap the app (or a mixed-language region) in `DirectionProvider` from `@/components/foundations/direction/direction`, with an explicit BCP 47 `locale` (`ar`, `he`, `en-US`, `zh-CN`). Set matching `lang` and `dir` on `<html>` for full-app RTL. CSS `dir` alone does not configure React Aria keyboard navigation or portal placement. Use `useDirection()` for custom interactions and put its value on custom portal roots.
- Use logical styles: `ms`/`me`, `ps`/`pe`, `start`/`end`, `text-start`/`text-end`, `border-s`/`border-e`, `rounded-s`/`rounded-e`, and inline logical CSS properties. Mirror navigation/disclosure glyphs and horizontal drawer motion in RTL. Preserve physical coordinates for measured geometry, charts, canvas, and decorative art. Keep code, OTP digits, email addresses and URLs in explicit LTR regions; isolate mixed text with `<bdi>` or `dir="auto"`. Translating labels and formatting application data is separate from layout direction. See https://www.boardui.com/rtl.

- Internal vertical scroll regions must soften the top edge with a progressive blur and surface fade once scrolled, rather than sharply clipping content. Keep headers outside the scroll region. Use a stationary, `pointer-events-none`, `aria-hidden` overlay in a relative wrapper: a 24px masked 1px backdrop blur, a 16px masked 4px backdrop blur, and a gradient from the enclosing semantic surface token to transparent. Ramp each layer's opacity from 0 to 1 over the first 24px of scrolling; keep it invisible at scrollTop 0. Apply opacity to the individual layers, never the overlay parent (a translucent parent creates a backdrop root and can break blur at normal browser zoom). Verify top/reset, overflow, light/dark mode, and 100% zoom; preserve keyboard scrolling and do not blur the whole content area. The `scroll-fade` registry item ships this recipe as `ScrollFade` + `useScrollFade` (`@/components/foundations/scroll-fade/scroll-fade`); reuse it rather than rebuilding the layers.

- Merge classes with `cx()` from `@/utils/cx` (tailwind-merge aware of BoardUI's composite text styles). No string concatenation, no plain `clsx`.
- Icons come from `@remixicon/react`, passed as component references (`leadingIcon={RiAddLine}`), not rendered elements.
- Form components build on `react-aria-components`; extend the installed BoardUI form components rather than raw `<input>`/`<select>`.
- Focus states: `outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring`.

When unsure about a token, a component's API, or working example code, ask the BoardUI MCP server: `get_theme`, `get_component`, `get_usage_examples`.
<!-- boardui:rules:end -->

# asms2 项目规则

上面的 BoardUI 规则块由 CLI 维护，**不要手工编辑块内内容**；本节是项目自身的工程约束，与视觉规则冲突时以本节为准。

## 1. 定位与边界

- asms2 是邮件**应用层**：发件走服务商 API（Resend / UnitPost / AhaSend），收件由服务商代收后 Webhook 回推。**不要引入 SMTP/IMAP 服务端**，也不要把"SMTP 退信"当作可实现的方案。
- 服务商差异只允许出现在 `src/server/providers/*`：Webhook 事件必须先归一为 `inbound / status / ignored`，业务层不得出现 `email_id`、`message.routing` 这类服务商私有字段名。
- 收件无法拒收：地址不存在或已过期时，只能写 `unrouted_message` 或丢弃，接口仍返回 200。
- 临时邮箱语义：创建后 1 小时考察期内收到**任意一封**邮件 → 永久保留（`retained_at` 有值、`expires_at` 置空）；无收件则失效且不复活。不要改回"每次收件续期"。

## 2. 目录与依赖方向

```
routes / components  →  server/fns  →  server/{mail,webhooks,jobs,telegram}  →  providers / db
```

- 禁止反向依赖：service 不 import 路由；adapter 不 import service、不读数据库、不读环境变量（运行时配置由调用方传入）。
- 新增服务商 = 在 `src/server/providers/` 实现 `MailProvider` + 在 `index.ts` 注册，业务层不得出现 `if (kind === 'resend')`。
- 只有 `createServerFn`（`src/server/fns/*`）和 `/api/*` 路由可以跨端；`db`、`crypto`、`providers` 不得进入客户端 bundle。
- Telegram 是附加通知通道：`src/server/telegram/*` 只做推送与 Bot 交互，不参与收发主链路；推送失败只记 `last_error`，不得影响 `ingestInbound` 的返回值。

## 3. 别名与导入

- `#/*` → `src/*`（业务代码）；`@/*` → 仓库根（BoardUI 的 `components/`、`utils/`）。
- 服务端函数按域拆分：`fns/site.ts`、`fns/mail.ts`、`fns/admin.ts`；返回值统一 `attempt()` 包装的 `{ ok, data | error }`。
- 类型只在编译期使用时必须 `import type`（`verbatimModuleSyntax: true`）。

## 4. 服务端安全红线

- 所有面板 server fn 第一行必须是 `requireUser()` 或 `requireAdmin()`；管理员路由还要在 `beforeLoad` 拦一次。
- 任何查询都必须显式带 `userId`；跨资源操作先 `getMailboxOrThrow(userId, id)`。新增查询漏掉 userId 视为 bug。
- 服务商 Key、OAuth Secret、Webhook Secret 只存 `encryptSecret()` 密文；接口只回末四位或 `hasSecret`，**永不回显明文**。
- Webhook 必须验签 + 按 `(endpointId, providerEventId)` 去重；处理失败返回 5xx 让服务商重试，验签失败返回 401。
- Telegram Webhook 固定路径 + `X-Telegram-Bot-Api-Secret-Token` 常量时间校验，按 `update_id` 去重；只处理私聊，群组一律拒绝。
- 邮件 HTML 入库前必须 `sanitizeEmailHtml()`，前端渲染必须放 sandbox iframe。

## 5. 数据与迁移

- 时间统一 Unix **秒**（`integer(..., { mode: 'timestamp' })`）；ID 用 nanoid 文本。
- 删除邮箱用软删，并把 `address` 改成 `原地址#id` 墓碑化，释放唯一索引；冷却期内禁止重新注册。
- **不要删列**：SQLite 删列会重建整表，`mailbox` 还引用 `domain`，风险高。废弃列保留并标 `@deprecated`，新增列用默认值。
- 改 schema 流程：改 `src/db/schema/*` → `bun run db:generate` → **人工检查 SQL** → `bun run db:migrate`。需要回填时在迁移文件里追加 `UPDATE`。
- 多表写入用 `db.batch([...])`；不要依赖远程交互式事务。

## 6. 业务规则

- 发件配额按用户、按站点时区切日；用单条 UPSERT + `WHERE sent_count < limit` 预留，失败可重试时回滚（`refundSendQuota`）。
- 发件必须走域名绑定的服务商，且域名 `status='verified'`、`sendingEnabled=true`；临时邮箱默认不能发信（`site_settings.allowTempSend`）。
- 域名级新建开关 `allowPermanentCreate` / `allowTempCreate` **只控制新建**，不影响已有邮箱；判断只在这两个字段，`purpose` 已废弃。
- 收件按 `to` 地址反查邮箱；一封邮件命中多个本站地址时只投第一个，其余记录在 `to_json`。
- 前缀只允许 `[a-z0-9]`，长度取站点配置（长期最短 3、临时最短 8），保留字见 `DEFAULT_RESERVED_WORDS`。保留字只有管理员能注册（如 `admin@`）；发往保留前缀的邮件统一转投同域名的 `admin@`，该邮箱不存在时按 unrouted 处理。

## 7. 命令与质量门

```bash
bun run dev                  # 开发
bun run build                # 构建（同时生成路由树）
bunx tsc --noEmit            # 类型检查，提交前必须过
bun run db:generate          # 生成迁移
bun run db:migrate           # 应用迁移
```

- 提交前：`bunx tsc --noEmit` + `bun run build` 均通过；涉及权限/配额/收发的改动，手动跑一次对应链路。
- `routeTree.gen.ts` 是生成物，不要手改；新增页面只加文件。
- 生产环境禁止执行 `scripts/seed-demo.ts`（会写入假服务商与演示域名）。
- 不要提交 `.env.local`、`data/*.db`、`.output/`。
