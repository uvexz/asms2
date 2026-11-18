import type { ReactNode } from 'react'
import {
  RiAttachment2,
  RiDeleteBinLine,
  RiInboxLine,
  RiMailSendLine,
  RiSearchLine,
  RiSpam2Line,
} from '@remixicon/react'

import { Avatar } from '@/components/base/avatar/avatar'
import { Counter } from '@/components/base/badges/counter'
import { StatusDot } from '@/components/base/badges/status-dot'
import { cx } from '@/utils/cx'

/**
 * 落地页的图版。
 *
 * 每个图版都是真 DOM，不是截图：暗色模式跟着 token 一起翻，缩放不失真，
 * 也不额外增加图片请求。外壳统一为「灰底相框 + 白纸内页」两层，靠 1px
 * 细线分隔，不使用阴影。
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-separator-border bg-background-secondary-default p-2">
      <div className="overflow-hidden rounded-2xl border border-separator-border bg-background-primary-default">
        {children}
      </div>
    </div>
  )
}

const MAILBOXES = [
  { prefix: 'k7fq2m9x', kind: '临时', unread: 3, active: true },
  { prefix: 'hello', kind: '长期', unread: 1, active: false },
  { prefix: 'studio', kind: '长期', unread: 0, active: false },
]

const FOLDERS = [
  { label: '收件箱', count: 4, icon: RiInboxLine, active: true },
  { label: '已发送', count: 0, icon: RiMailSendLine, active: false },
  { label: '垃圾邮件', count: 0, icon: RiSpam2Line, active: false },
  { label: '回收站', count: 0, icon: RiDeleteBinLine, active: false },
]

const MESSAGES = [
  {
    from: 'GitHub',
    initial: 'G',
    subject: '请验证你的设备',
    snippet: '你的验证码是 482 913，10 分钟内有效。',
    time: '09:41',
    unread: true,
  },
  {
    from: 'Linear',
    initial: 'L',
    subject: '每周摘要 · 第 46 周',
    snippet: '团队本周关闭了 12 个 issue。',
    time: '09:12',
    unread: true,
  },
  {
    from: 'Vercel',
    initial: 'V',
    subject: '部署成功：asms2',
    snippet: 'Production 已在 42 秒内完成部署。',
    time: '昨天',
    unread: false,
  },
  {
    from: 'Stripe',
    initial: 'S',
    subject: '11 月发票已生成',
    snippet: '本期账单已结清，无需操作。',
    time: '昨天',
    unread: false,
  },
  {
    from: 'Sentry',
    initial: 'S',
    subject: '新问题：TypeError in worker',
    snippet: 'sweep cron 在过去一小时失败了 2 次。',
    time: '昨天',
    unread: false,
  },
  {
    from: 'Figma',
    initial: 'F',
    subject: '评论区有新回复',
    snippet: '「收件箱空状态」这条有了 2 条新评论。',
    time: '周一',
    unread: false,
  },
]

export function InboxExhibit() {
  return (
    <Frame>
      <div className="flex md:h-[27rem]">
        <aside className="hidden w-46 shrink-0 flex-col border-e border-separator-border md:flex">
          <div className="flex flex-col gap-0.5 p-2.5">
            <p className="px-1.5 pb-1 font-mono text-caption-2-regular text-text-tertiary">
              邮箱
            </p>
            {MAILBOXES.map((box) => (
              <div
                key={box.prefix}
                className={cx(
                  'flex items-center gap-2 rounded-lg px-1.5 py-1.5',
                  box.active && 'bg-background-secondary-default',
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    'size-1.5 shrink-0 rounded-full',
                    box.active
                      ? 'bg-accent-500'
                      : 'bg-background-tertiary-hover',
                  )}
                />
                <span
                  dir="ltr"
                  className="min-w-0 flex-1 truncate text-start font-mono text-body-2-medium text-text-primary"
                >
                  {box.prefix}
                </span>
                {box.unread > 0 ? (
                  <Counter color="neutral">{box.unread}</Counter>
                ) : (
                  <span className="text-caption-2-regular text-text-tertiary">
                    {box.kind}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-0.5 border-t border-separator-border p-2.5">
            {FOLDERS.map((folder) => (
              <div
                key={folder.label}
                className={cx(
                  'flex items-center gap-2 rounded-lg px-1.5 py-1',
                  folder.active && 'bg-background-secondary-default',
                )}
              >
                <folder.icon
                  className="size-3.5 shrink-0 text-foreground-icon-tertiary"
                  aria-hidden
                />
                <span
                  className={cx(
                    'flex-1 text-body-2-regular',
                    folder.active ? 'text-text-primary' : 'text-text-secondary',
                  )}
                >
                  {folder.label}
                </span>
                {folder.count > 0 ? (
                  <span className="font-mono text-caption-2-regular text-text-tertiary">
                    {folder.count}
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          <p className="mt-auto border-t border-separator-border px-3 py-2.5 font-mono text-caption-2-regular text-text-tertiary">
            长期 2 / 5 · 临时 3
          </p>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col lg:w-72 lg:flex-none lg:border-e lg:border-separator-border">
          <div className="flex items-center gap-2 border-b border-separator-border px-3 py-2.5">
            <span className="text-body-2-medium text-text-primary">收件箱</span>
            <span className="font-mono text-caption-2-regular text-text-tertiary">
              4
            </span>
            <RiSearchLine
              className="ms-auto size-3.5 text-foreground-icon-tertiary"
              aria-hidden
            />
          </div>

          <div className="flex flex-col">
            {MESSAGES.map((message) => (
              <div
                key={message.subject}
                className={cx(
                  'flex gap-2.5 border-b border-separator-border px-3 py-2.5 last:border-b-0',
                  message.unread && 'bg-background-secondary-default',
                )}
              >
                <Avatar
                  size="sm"
                  initials={message.initial}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={cx(
                        'truncate text-body-2-medium',
                        message.unread
                          ? 'text-text-primary'
                          : 'text-text-secondary',
                      )}
                    >
                      {message.from}
                    </span>
                    <span className="ms-auto shrink-0 font-mono text-caption-2-regular text-text-tertiary">
                      {message.time}
                    </span>
                  </div>
                  <p
                    className={cx(
                      'mt-0.5 truncate text-body-2-regular',
                      message.unread
                        ? 'text-text-primary'
                        : 'text-text-secondary',
                    )}
                  >
                    {message.subject}
                  </p>
                  <p className="mt-0.5 truncate text-caption-1-regular text-text-tertiary">
                    {message.snippet}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="hidden min-w-0 flex-1 flex-col lg:flex">
          <div className="border-b border-separator-border px-4 py-3">
            <p className="text-body-medium text-text-primary">请验证你的设备</p>
            <div className="mt-2 flex items-center gap-2">
              <Avatar size="xs" initials="G" />
              <span className="min-w-0 truncate text-caption-1-regular text-text-secondary">
                GitHub · notifications@github.com
              </span>
              <span className="ms-auto shrink-0 font-mono text-caption-2-regular text-text-tertiary">
                09:41
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 border-b border-separator-border px-4 py-2 text-caption-1-regular text-text-secondary">
            <span>回复</span>
            <span>转发</span>
            <span className="ms-auto truncate font-mono text-caption-2-regular text-text-tertiary">
              k7fq2m9x@mail.example.com
            </span>
          </div>

          <div className="flex flex-1 flex-col gap-3 px-4 py-4">
            <p className="text-body-2-regular text-text-secondary">
              我们收到了来自新设备的登录请求，请输入下面的验证码完成验证：
            </p>
            <p
              dir="ltr"
              className="text-start font-mono text-title-1-medium tracking-wider text-text-primary"
            >
              482 913
            </p>
            <p className="text-body-2-regular text-text-secondary">
              如果不是你本人操作，忽略这封邮件即可。
            </p>

            <div className="rounded-lg border border-separator-border bg-background-secondary-default px-3 py-2">
              <p className="text-caption-1-semibold text-text-primary">
                不是你发起的登录？
              </p>
              <p className="mt-0.5 text-caption-1-regular text-text-secondary">
                改掉密码，再到安全设置里检查已授权的设备。
              </p>
            </div>

            <p className="font-mono text-caption-2-regular text-text-tertiary">
              GitHub, Inc. · 88 Colin P Kelly Jr St
            </p>

            <div className="mt-auto flex items-center gap-1.5 border-t border-separator-border pt-2.5 text-caption-1-regular text-text-tertiary">
              <RiAttachment2 className="size-3.5 shrink-0" aria-hidden />2
              个附件 · 只记录元数据
            </div>
          </div>
        </div>
      </div>
    </Frame>
  )
}

export function TempExhibit({ ttlLabel }: { ttlLabel: string }) {
  return (
    <Frame>
      <div className="grid md:grid-cols-2">
        <div className="flex flex-col p-5 md:p-6">
          <span
            dir="ltr"
            className="inline-flex w-fit items-center rounded-full border border-separator-border px-2.5 py-1 text-start font-mono text-caption-1-regular text-text-secondary"
          >
            k7fq2m9x@mail.example.com
          </span>

          <div className="mt-8 flex items-end gap-3">
            <span
              dir="ltr"
              className="text-start font-mono text-display-4-medium tabular-nums text-text-primary"
            >
              00:47
            </span>
            <span className="pb-1.5 text-body-2-regular text-text-tertiary">
              / {ttlLabel}
            </span>
          </div>

          <div
            className="mt-3 h-1 w-full overflow-hidden rounded-full bg-background-tertiary-default"
            role="img"
            aria-label={`临时地址剩余时间：${ttlLabel}中的 47 分钟`}
          >
            <div className="h-full w-[78%] rounded-full bg-accent-500" />
          </div>

          <p className="mt-3 font-mono text-caption-2-regular text-text-secondary">
            expires_at 2026-11-19 01:12
          </p>
        </div>

        <div className="flex flex-col justify-center border-t border-separator-border p-5 md:border-s md:border-t-0 md:p-6">
          <p className="font-mono text-caption-2-regular text-text-tertiary">
            新邮件 · 00:47
          </p>
          <div className="mt-2 rounded-xl border border-separator-border bg-background-secondary-default p-3">
            <div className="flex items-center gap-2">
              <Avatar size="xs" initials="G" />
              <span className="text-body-2-medium text-text-primary">
                GitHub
              </span>
            </div>
            <p className="mt-2 text-body-2-medium text-text-primary">
              请验证你的设备
            </p>
            <p className="mt-0.5 text-caption-1-regular text-text-secondary">
              你的验证码是 482 913，10 分钟内有效。
            </p>
          </div>

          <p className="mt-3 flex items-center gap-1.5 text-caption-1-regular text-text-secondary">
            <StatusDot color="green" />
            收到 1 封 · 已永久保留
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1 border-t border-separator-border bg-background-secondary-default px-5 py-3 font-mono text-caption-2-regular text-text-secondary md:px-6">
        <p className="flex flex-wrap gap-x-3 md:flex-nowrap">
          <span className="whitespace-nowrap md:w-16">t+00:47</span>
          <span className="whitespace-nowrap md:w-24">收到 1 封</span>
          <span className="whitespace-nowrap text-text-primary">
            retained_at 2026-11-19 00:47
          </span>
        </p>
        <p className="flex flex-wrap gap-x-3 md:flex-nowrap">
          <span className="whitespace-nowrap md:w-16">t+01:00</span>
          <span className="whitespace-nowrap md:w-24">收到 0 封</span>
          <span className="whitespace-nowrap">expires_at 已失效，不复活</span>
        </p>
      </div>
    </Frame>
  )
}

export function TelegramExhibit() {
  return (
    <Frame>
      <div className="grid md:grid-cols-[23rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 p-5 md:p-6">
          <div className="flex items-center gap-2 border-b border-separator-border pb-3">
            <Avatar size="sm" initials="A" />
            <span className="text-body-2-semibold text-text-primary">
              asms2 bot
            </span>
            <span className="font-mono text-caption-2-regular text-text-tertiary">
              private chat
            </span>
          </div>

          <div className="max-w-76 self-start rounded-2xl rounded-es-md border border-separator-border bg-background-secondary-default px-3 py-2.5">
            <p className="font-mono text-caption-2-regular text-text-tertiary">
              新邮件 · GitHub
            </p>
            <p className="mt-1 text-body-2-medium text-text-primary">
              请验证你的设备
            </p>
            <div className="mt-2 flex items-center justify-between gap-4 rounded-lg border border-separator-border bg-background-primary-default px-2.5 py-1.5">
              <span
                dir="ltr"
                className="text-start font-mono text-body-medium tracking-wider text-text-primary"
              >
                482 913
              </span>
              <span className="text-caption-2-regular text-text-tertiary">
                复制
              </span>
            </div>
          </div>

          <div className="self-end rounded-2xl rounded-ee-md bg-background-tertiary-default px-3 py-2 font-mono text-body-2-regular text-text-primary">
            /new temp
          </div>

          <div className="max-w-76 self-start rounded-2xl rounded-es-md border border-separator-border bg-background-secondary-default px-3 py-2.5">
            <p className="font-mono text-caption-2-regular text-text-tertiary">
              已创建
            </p>
            <p
              dir="ltr"
              className="mt-1 text-start font-mono text-body-2-medium text-text-primary"
            >
              temp-k7fq2m9x@mail.example.com
            </p>
            <p className="mt-1 text-caption-1-regular text-text-secondary">
              收到任意一封邮件即可永久保留。
            </p>
          </div>
        </div>

        <div className="border-t border-separator-border p-5 md:border-s md:border-t-0 md:p-6">
          <dl className="flex flex-col gap-3">
            {[
              { command: '/new [前缀]', note: '建临时地址，不填就随机' },
              { command: '/list', note: '按未读数排的邮箱列表' },
              { command: '/help', note: '全部命令与按钮说明' },
            ].map((item) => (
              <div key={item.command}>
                <dt
                  dir="ltr"
                  className="text-start font-mono text-body-2-medium text-text-primary"
                >
                  {item.command}
                </dt>
                <dd className="mt-0.5 text-caption-1-regular text-text-secondary">
                  {item.note}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 font-mono text-caption-2-regular text-text-tertiary">
            只处理私聊 · 群组一律拒绝
          </p>
        </div>
      </div>
    </Frame>
  )
}

const PROVIDERS = [
  { name: 'Resend', role: '发件 · 收件', key: 're_••••7f2a' },
  { name: 'AhaSend', role: '发件', key: 'ah_••••31c9' },
  { name: 'UnitPost', role: '发件', key: 'up_••••b08e' },
]

export function ProviderExhibit() {
  return (
    <Frame>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-separator-border px-5 py-3.5">
        <span
          dir="ltr"
          className="text-start font-mono text-body-2-medium text-text-primary"
        >
          mail.example.com
        </span>
        <StatusDot color="green" />
        <span className="text-caption-1-regular text-text-secondary">
          已验证
        </span>
        <span className="ms-auto hidden font-mono text-caption-2-regular text-text-tertiary sm:inline">
          收件已开启 · 发件已开启
        </span>
      </div>

      <table className="w-full border-collapse sm:table-fixed">
        <caption className="sr-only">域名绑定的服务商</caption>
        <thead>
          <tr className="text-caption-1-medium text-text-tertiary">
            <th
              scope="col"
              className="px-5 py-2 text-start font-normal sm:w-[32%]"
            >
              服务商
            </th>
            <th
              scope="col"
              className="px-2 py-2 text-start font-normal sm:w-[26%]"
            >
              用途
            </th>
            <th
              scope="col"
              className="hidden px-2 py-2 text-start font-normal sm:table-cell sm:w-[28%]"
            >
              Key
            </th>
            <th
              scope="col"
              className="px-5 py-2 text-end font-normal sm:w-[14%]"
            >
              状态
            </th>
          </tr>
        </thead>
        <tbody>
          {PROVIDERS.map((provider) => (
            <tr
              key={provider.name}
              className="border-t border-separator-border"
            >
              <td className="px-5 py-3 text-body-2-medium text-text-primary">
                {provider.name}
              </td>
              <td className="px-2 py-3 text-body-2-regular text-text-secondary">
                {provider.role}
              </td>
              <td
                dir="ltr"
                className="hidden px-2 py-3 text-start font-mono text-caption-1-regular text-text-secondary sm:table-cell"
              >
                {provider.key}
              </td>
              <td className="px-5 py-3 text-end">
                <span className="inline-flex items-center gap-1.5 text-caption-1-regular text-text-secondary">
                  <StatusDot color="green" />
                  已连接
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Frame>
  )
}

export function ApiExhibit() {
  return (
    <Frame>
      <div className="grid lg:grid-cols-[1.15fr_1fr]">
        <div className="border-b border-separator-border lg:border-e lg:border-b-0">
          <div className="flex items-center justify-between gap-3 border-b border-separator-border px-4 py-2">
            <span
              dir="ltr"
              className="text-start font-mono text-caption-2-regular text-text-tertiary"
            >
              POST /api/v1/mailboxes
            </span>
            <span className="font-mono text-caption-2-regular text-text-tertiary">
              请求
            </span>
          </div>
          <pre
            dir="ltr"
            className="overflow-x-auto p-4 text-start font-mono text-caption-2-regular text-text-secondary lg:text-body-2-regular"
          >
            <code>{`SITE=https://mail.example.com

curl -X POST $SITE/api/v1/mailboxes \\
  -H "x-api-key: asms_••••7f2a" \\
  -d '{"kind":"temp","localPart":"k7fq2m9x"}'`}</code>
          </pre>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 border-b border-separator-border px-4 py-2">
            <span
              dir="ltr"
              className="text-start font-mono text-caption-2-regular text-text-tertiary"
            >
              201 Created
            </span>
            <span className="font-mono text-caption-2-regular text-text-tertiary">
              响应
            </span>
          </div>
          <pre
            dir="ltr"
            className="overflow-x-auto p-4 text-start font-mono text-caption-2-regular text-text-secondary lg:text-body-2-regular"
          >
            <code>{`{
  "ok": true,
  "data": {
    "address": "k7fq2m9x@mail.example.com",
    "kind": "temp",
    "expiresAt": 1795012419000,
    "retained": false
  }
}`}</code>
          </pre>
        </div>
      </div>

      <p className="border-t border-separator-border bg-background-secondary-default px-4 py-2.5 font-mono text-caption-2-regular text-text-secondary">
        key 只显示一次 · 默认 120 次 / 分钟 · 超额返回 429
      </p>
    </Frame>
  )
}
