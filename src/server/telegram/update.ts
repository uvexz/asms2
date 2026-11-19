import { db } from '#/db/client'
import { telegramUpdate } from '#/db/schema'
import { AppError } from '#/server/errors'
import { randomNameLocalPart } from '#/lib/name-prefix'
import { escapeHtml, htmlToText } from '#/server/mail/content'
import {
  createMailbox,
  getMailboxOrThrow,
  listMailboxes,
  removeMailbox,
} from '#/server/mail/mailbox'
import { getMessage, listMessages, markRead } from '#/server/mail/message'
import { getSiteSettings } from '#/server/settings'
import {
  answerCallbackQuery,
  editMessageText,
  sendMessage,
  TelegramError,
} from './api'
import type {
  InlineKeyboard,
  TgCallbackQuery,
  TgMessage,
  TgUpdate,
  TgUser,
} from './api'
import { getTelegramRuntime, recordTelegramError } from './config'
import type { TelegramRuntime } from './config'
import {
  formatRemaining,
  KIND_LABEL,
  renderInboxPreview,
  renderMailboxList,
  renderMessageDetail,
  truncateText,
} from './format'
import {
  bindChat,
  consumeBindCode,
  getLinkByChat,
  MAX_LINKS_PER_USER,
  unbindChat,
} from './link'

const MAX_LISTED_MAILBOXES = 8

/**
 * Webhook 入口：去重 → 分发。
 * Telegram 在超时后会重推同一 update_id，先落库抢占，抢不到就当重复请求丢掉。
 */
export async function handleTelegramUpdate(update: TgUpdate): Promise<void> {
  const runtime = await getTelegramRuntime()
  if (!runtime) return

  const message = update.message ?? update.edited_message
  const chatId = String(
    message?.chat.id ?? update.callback_query?.message?.chat.id ?? '',
  )

  const claimed = await db
    .insert(telegramUpdate)
    .values({
      updateId: update.update_id,
      chatId: chatId || null,
      kind: update.callback_query ? 'callback' : 'message',
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ updateId: telegramUpdate.updateId })

  if (claimed.length === 0) return

  try {
    if (update.callback_query) {
      await handleCallback(runtime, update.callback_query)
    } else if (update.message) {
      // 编辑消息、贴纸、图片等一律不处理，避免噪音
      await handleMessage(runtime, update.message)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : '处理失败'
    console.error('[telegram] update failed:', reason)
    await recordTelegramError(reason)
    if (chatId) {
      await sendMessage(runtime.token, {
        chatId,
        text: `处理失败：${escapeHtml(reason)}`,
      }).catch(() => undefined)
    }
  }
}

/* ---------------------------------------------------------------- message */

async function handleMessage(runtime: TelegramRuntime, message: TgMessage) {
  const from = message.from
  if (!from || from.is_bot) return
  const chatId = String(message.chat.id)

  if (message.chat.type !== 'private') {
    await reply(
      runtime,
      chatId,
      '请在私聊中使用本机器人，群组里不处理邮件内容。',
    )
    return
  }

  const text = message.text?.trim()
  if (!text) {
    await reply(runtime, chatId, '只支持文字命令，发送 /help 查看用法。')
    return
  }
  if (!text.startsWith('/')) {
    await reply(runtime, chatId, '发送 /help 查看可用命令。')
    return
  }

  const [rawCommand, ...args] = text.split(/\s+/)
  const command = rawCommand.slice(1).split('@')[0].toLowerCase()
  const link = await getLinkByChat(chatId)

  switch (command) {
    case 'start':
      if (args[0]) {
        await handleBind(runtime, chatId, args[0], link, from)
      } else {
        await handleStart(runtime, chatId, Boolean(link))
      }
      return

    case 'help':
      await reply(runtime, chatId, HELP_TEXT, MAIN_KEYBOARD)
      return

    case 'bind':
      if (!args[0]) {
        await reply(
          runtime,
          chatId,
          '用法：/bind <绑定码>\n绑定码在网页「个人设置 → Telegram 通知」生成。',
        )
        return
      }
      await handleBind(runtime, chatId, args[0], link, from)
      return

    case 'unbind':
      if (!link) {
        await reply(runtime, chatId, '当前会话尚未绑定账号。')
        return
      }
      await reply(
        runtime,
        chatId,
        '确认解除当前会话与站内账号的绑定？解绑后不再接收新邮件推送。',
        [[{ text: '确认解绑', callback_data: 'unbind:yes' }]],
      )
      return

    case 'new':
      await handleNew(runtime, chatId, link, args[0])
      return

    case 'list':
      await handleList(runtime, chatId, link)
      return

    case 'id':
      await reply(runtime, chatId, `当前会话 chat_id：<code>${chatId}</code>`)
      return

    default:
      await reply(runtime, chatId, `未知命令 /${command}\n\n${HELP_TEXT}`)
  }
}

const HELP_TEXT = [
  '<b>可用命令</b>',
  '/start 查看菜单与绑定状态',
  '/bind &lt;码&gt; 绑定站内账号',
  '/unbind 解除绑定',
  '/new [前缀] 创建临时邮箱（不填前缀则随机）',
  '/list 查看我的邮箱与未读',
  '/id 查看当前会话 chat_id',
  '/help 查看本说明',
  '',
  '收到新邮件会主动推送，点「查看正文」可直接阅读。',
].join('\n')

const MAIN_KEYBOARD: InlineKeyboard = [
  [
    { text: '新建临时邮箱', callback_data: 'new:temp' },
    { text: '我的邮箱', callback_data: 'l:0' },
  ],
]

async function handleStart(
  runtime: TelegramRuntime,
  chatId: string,
  bound: boolean,
) {
  if (bound) {
    await reply(
      runtime,
      chatId,
      '已绑定站内账号，新邮件会推送到这里。\n\n' + HELP_TEXT,
      MAIN_KEYBOARD,
    )
    return
  }

  await reply(
    runtime,
    chatId,
    [
      '欢迎使用 asms2 邮件助手。',
      '',
      '绑定步骤：',
      '1. 打开网页「个人设置 → Telegram 通知」',
      '2. 点「生成绑定码」',
      '3. 回来发送 /bind 绑定码',
      '',
      '绑定后可以在这里收新邮件提醒、创建临时邮箱。',
    ].join('\n'),
  )
}

async function handleBind(
  runtime: TelegramRuntime,
  chatId: string,
  code: string,
  existing: Awaited<ReturnType<typeof getLinkByChat>>,
  tgUser: TgUser,
) {
  if (existing) {
    await reply(
      runtime,
      chatId,
      '当前会话已经绑定了账号，如需换绑请先 /unbind。',
    )
    return
  }

  const userId = await consumeBindCode(code)
  if (!userId) {
    await reply(
      runtime,
      chatId,
      '绑定码无效或已过期。请到网页重新生成（10 分钟内有效）。',
    )
    return
  }

  const result = await bindChat({ chatId, userId, tgUser })
  if (!result.ok) {
    const reason =
      result.reason === 'chat_taken'
        ? '该 Telegram 会话已绑定其他账号，请先在原账号解绑。'
        : result.reason === 'link_limit'
          ? `一个账号最多绑定 ${MAX_LINKS_PER_USER} 个 Telegram 会话。`
          : '账号不存在或已被删除。'
    await reply(runtime, chatId, reason)
    return
  }

  await reply(
    runtime,
    chatId,
    [
      `绑定成功：<b>${escapeHtml(result.email)}</b>`,
      '新邮件会推送到这里。',
      '',
      HELP_TEXT,
    ].join('\n'),
    MAIN_KEYBOARD,
  )
}

async function handleNew(
  runtime: TelegramRuntime,
  chatId: string,
  link: Awaited<ReturnType<typeof getLinkByChat>>,
  prefix: string | undefined,
) {
  if (!link) {
    await reply(runtime, chatId, NEED_BIND_TEXT)
    return
  }

  const settings = await getSiteSettings()
  const localPart =
    prefix?.trim().toLowerCase() ||
    randomNameLocalPart({
      minLength: Math.max(settings.tempPrefixMin, 8),
      maxLength: settings.prefixMax,
    })

  try {
    const box = await createMailbox(link.userId, {
      kind: 'temp',
      localPart,
    })
    const remaining = formatRemaining(box.expiresAt)
    await reply(
      runtime,
      chatId,
      [
        '临时邮箱已创建',
        `<code>${escapeHtml(box.address)}</code>`,
        remaining
          ? `${remaining}，期间收到任意邮件即永久保留。`
          : '期间收到任意邮件即永久保留。',
      ].join('\n'),
      [
        [{ text: '查看收件', callback_data: `b:${box.id}` }],
        [{ text: '再建一个', callback_data: 'new:temp' }],
      ],
    )
  } catch (error) {
    if (error instanceof AppError) {
      await reply(runtime, chatId, error.message)
      return
    }
    throw error
  }
}

async function handleList(
  runtime: TelegramRuntime,
  chatId: string,
  link: Awaited<ReturnType<typeof getLinkByChat>>,
) {
  if (!link) {
    await reply(runtime, chatId, NEED_BIND_TEXT)
    return
  }

  const items = await listMailboxes(link.userId)
  await reply(runtime, chatId, renderMailboxList(items), mailboxKeyboard(items))
}

const NEED_BIND_TEXT = [
  '当前会话还没有绑定账号。',
  '',
  '打开网页「个人设置 → Telegram 通知」生成绑定码，然后发送：',
  '/bind 绑定码',
].join('\n')

function mailboxKeyboard(
  items: Awaited<ReturnType<typeof listMailboxes>>,
): InlineKeyboard {
  const keyboard: InlineKeyboard = items
    .slice(0, MAX_LISTED_MAILBOXES)
    .map((item) => [
      {
        text: truncateText(
          `${item.unreadCount > 0 ? `(${item.unreadCount}) ` : ''}${item.address}`,
          56,
        ),
        callback_data: `b:${item.id}`,
      },
    ])
  keyboard.push([{ text: '新建临时邮箱', callback_data: 'new:temp' }])
  return keyboard
}

/* --------------------------------------------------------------- callback */

async function handleCallback(
  runtime: TelegramRuntime,
  query: TgCallbackQuery,
) {
  const chatId = query.message ? String(query.message.chat.id) : ''
  const messageId = query.message?.message_id
  const data = query.data ?? ''

  if (!chatId) {
    await answerCallbackQuery(runtime.token, query.id).catch(() => undefined)
    return
  }

  const [action, ...rest] = data.split(':')
  const arg = rest.join(':')

  // 「标记已读」先把事做完再回 toast，其余先停掉 loading
  if (action === 'r') {
    const link = await getLinkByChat(chatId)
    if (!link) {
      await answerCallbackQuery(runtime.token, query.id, '请先绑定账号').catch(
        () => undefined,
      )
      return
    }
    await markRead(link.userId, arg, true)
    await answerCallbackQuery(runtime.token, query.id, '已标记已读').catch(
      () => undefined,
    )
    return
  }

  await answerCallbackQuery(runtime.token, query.id).catch(() => undefined)

  const link = await getLinkByChat(chatId)
  if (!link) {
    await replaceMessage(runtime, chatId, messageId, NEED_BIND_TEXT)
    return
  }

  switch (action) {
    case 'b':
      await guard(runtime, chatId, messageId, () =>
        showMailbox(runtime, chatId, messageId, link.userId, arg),
      )
      return

    case 'd':
      await guard(runtime, chatId, messageId, () =>
        showMessage(runtime, chatId, messageId, link.userId, arg),
      )
      return

    case 'l':
      await handleList(runtime, chatId, link)
      return

    case 'new':
      await handleNew(runtime, chatId, link, undefined)
      return

    case 'rm':
      await guard(runtime, chatId, messageId, () =>
        confirmRemove(runtime, chatId, messageId, link.userId, arg),
      )
      return

    case 'rmy':
      await guard(runtime, chatId, messageId, () =>
        doRemove(runtime, chatId, messageId, link.userId, arg),
      )
      return

    case 'rmn':
      await replaceMessage(runtime, chatId, messageId, '已取消删除。', [
        [{ text: '返回邮箱列表', callback_data: 'l:0' }],
      ])
      return

    case 'unbind':
      if (arg === 'yes') {
        await unbindChat(chatId, link.userId)
        await replaceMessage(
          runtime,
          chatId,
          messageId,
          '已解除绑定。重新绑定请到网页生成新的绑定码。',
        )
      }
      return

    default:
      await replaceMessage(
        runtime,
        chatId,
        messageId,
        '操作已失效，发送 /help 重新开始。',
      )
  }
}

async function showMailbox(
  runtime: TelegramRuntime,
  chatId: string,
  messageId: number | undefined,
  userId: string,
  mailboxId: string,
) {
  const box = await getMailboxOrThrow(userId, mailboxId, { allowExpired: true })
  const settings = await getSiteSettings()
  const { items } = await listMessages(userId, {
    mailboxId,
    folder: 'inbox',
    limit: 5,
  })

  const text = [
    renderInboxPreview({
      address: box.address,
      items,
      timezone: settings.timezone,
    }),
    box.kind === 'temp'
      ? `\n<i>${KIND_LABEL.temp} · ${box.expiresAt ? formatRemaining(box.expiresAt.getTime()) : '已永久保留'}</i>`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  const keyboard: InlineKeyboard = items.map((item) => [
    {
      text: truncateText(
        `${item.isRead ? '' : '● '}${item.subject?.trim() || '(无主题)'} — ${item.fromAddress}`,
        58,
      ),
      callback_data: `d:${item.id}`,
    },
  ])
  keyboard.push([{ text: '返回邮箱列表', callback_data: 'l:0' }])
  if (box.kind === 'temp') {
    keyboard.push([{ text: '删除该临时邮箱', callback_data: `rm:${box.id}` }])
  }

  await replaceMessage(runtime, chatId, messageId, text, keyboard)
}

async function showMessage(
  runtime: TelegramRuntime,
  chatId: string,
  messageId: number | undefined,
  userId: string,
  targetMessageId: string,
) {
  const detail = await getMessage(userId, targetMessageId)
  await markRead(userId, targetMessageId, true).catch(() => undefined)

  const settings = await getSiteSettings()
  const body = detail.text ?? (detail.html ? htmlToText(detail.html) : null)
  const text = renderMessageDetail({
    mailboxAddress: detail.mailboxAddress,
    subject: detail.subject,
    fromName: detail.fromName,
    fromAddress: detail.fromAddress,
    to: detail.to,
    receivedAt: detail.receivedAt,
    timezone: settings.timezone,
    body,
    attachmentCount: detail.attachmentCount,
  })

  const keyboard: InlineKeyboard = []
  const siteUrl = (
    settings.siteUrl ??
    process.env.BETTER_AUTH_URL ??
    ''
  ).replace(/\/$/, '')
  if (siteUrl) {
    keyboard.push([
      { text: '在网页中打开', url: `${siteUrl}/mail/${targetMessageId}` },
    ])
  }
  keyboard.push([
    { text: '返回该邮箱', callback_data: `b:${detail.mailboxId}` },
    { text: '邮箱列表', callback_data: 'l:0' },
  ])

  await replaceMessage(runtime, chatId, messageId, text, keyboard)
}

async function confirmRemove(
  runtime: TelegramRuntime,
  chatId: string,
  messageId: number | undefined,
  userId: string,
  mailboxId: string,
) {
  const box = await getMailboxOrThrow(userId, mailboxId, { allowExpired: true })
  if (box.kind !== 'temp') {
    await replaceMessage(
      runtime,
      chatId,
      messageId,
      '只有临时邮箱可以在 Telegram 里删除，长期邮箱请到网页操作。',
    )
    return
  }

  await replaceMessage(
    runtime,
    chatId,
    messageId,
    `确认删除 <code>${escapeHtml(box.address)}</code>？\n删除后地址会进入冷却期，无法立即重新注册。`,
    [
      [
        { text: '确认删除', callback_data: `rmy:${box.id}` },
        { text: '取消', callback_data: 'rmn:0' },
      ],
    ],
  )
}

async function doRemove(
  runtime: TelegramRuntime,
  chatId: string,
  messageId: number | undefined,
  userId: string,
  mailboxId: string,
) {
  const box = await getMailboxOrThrow(userId, mailboxId, { allowExpired: true })
  if (box.kind !== 'temp') {
    await replaceMessage(
      runtime,
      chatId,
      messageId,
      '只有临时邮箱可以在这里删除。',
    )
    return
  }

  await removeMailbox(userId, mailboxId)
  await replaceMessage(
    runtime,
    chatId,
    messageId,
    `已删除 <code>${escapeHtml(box.address)}</code>。`,
    [[{ text: '返回邮箱列表', callback_data: 'l:0' }]],
  )
}

/* ----------------------------------------------------------------- utils */

/** 预期内的业务错误（邮箱不存在/已失效）直接回显给用户，不用抛到顶层 */
async function guard(
  runtime: TelegramRuntime,
  chatId: string,
  messageId: number | undefined,
  run: () => Promise<void>,
) {
  try {
    await run()
  } catch (error) {
    if (error instanceof AppError) {
      await replaceMessage(runtime, chatId, messageId, error.message, [
        [{ text: '返回邮箱列表', callback_data: 'l:0' }],
      ])
      return
    }
    throw error
  }
}

async function reply(
  runtime: TelegramRuntime,
  chatId: string,
  text: string,
  keyboard?: InlineKeyboard,
) {
  await sendMessage(runtime.token, { chatId, text, keyboard })
}

/** 优先原地编辑，失败（消息太旧 / 未变化）则退回新消息 */
async function replaceMessage(
  runtime: TelegramRuntime,
  chatId: string,
  messageId: number | undefined,
  text: string,
  keyboard?: InlineKeyboard,
) {
  if (messageId) {
    try {
      await editMessageText(runtime.token, {
        chatId,
        messageId,
        text,
        keyboard,
      })
      return
    } catch (error) {
      if (
        error instanceof TelegramError &&
        /message is not modified/i.test(error.message)
      ) {
        return
      }
    }
  }
  await sendMessage(runtime.token, { chatId, text, keyboard })
}
