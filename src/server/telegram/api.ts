/**
 * 极薄的 Telegram Bot API 客户端。
 *
 * 只封装本项目用到的几个方法，不引第三方 SDK：
 * Token 来自数据库（每个站点一份），需要在请求期解密后传入，
 * 所以这里全部是无状态函数，调用方负责取 token。
 */

const API_BASE = 'https://api.telegram.org'
const TIMEOUT_MS = 15_000

/* ------------------------------------------------------------------ types */

export interface TgUser {
  id: number
  is_bot: boolean
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
}

export interface TgChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  first_name?: string
  last_name?: string
  username?: string
  title?: string
}

export interface TgMessage {
  message_id: number
  date: number
  text?: string
  chat: TgChat
  from?: TgUser
}

export interface TgCallbackQuery {
  id: string
  from: TgUser
  message?: TgMessage
  data?: string
}

export interface TgUpdate {
  update_id: number
  message?: TgMessage
  edited_message?: TgMessage
  callback_query?: TgCallbackQuery
}

export interface InlineKeyboardButton {
  text: string
  callback_data?: string
  url?: string
}

export type InlineKeyboard = InlineKeyboardButton[][]

export interface SendMessageParams {
  chatId: string
  text: string
  keyboard?: InlineKeyboard
  disablePreview?: boolean
}

export interface TelegramMe {
  id: number
  is_bot: boolean
  first_name: string
  username?: string
}

/* ------------------------------------------------------------------ error */

interface ApiEnvelope<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
  parameters?: {
    retry_after?: number
    migrate_to_chat_id?: number
  }
}

export class TelegramError extends Error {
  code: string
  retryable: boolean
  httpStatus?: number
  retryAfter?: number

  constructor(
    message: string,
    options: {
      code?: string
      retryable?: boolean
      httpStatus?: number
      retryAfter?: number
    } = {},
  ) {
    super(message)
    this.name = 'TelegramError'
    this.code = options.code ?? 'telegram_error'
    this.retryable = options.retryable ?? false
    this.httpStatus = options.httpStatus
    this.retryAfter = options.retryAfter
  }
}

/* ----------------------------------------------------------------- client */

async function callBotApi<T>(
  token: string,
  method: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (!token) {
    throw new TelegramError('Bot Token 未配置', { code: 'token_missing' })
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    // 不要把 URL 打进日志：里面有 Bot Token
    throw new TelegramError(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Telegram 请求超时'
        : 'Telegram 网络请求失败',
      { code: 'network_error', retryable: true },
    )
  }

  let body: ApiEnvelope<T>
  try {
    body = (await response.json()) as ApiEnvelope<T>
  } catch {
    throw new TelegramError('Telegram 返回了非 JSON 响应', {
      code: 'invalid_response',
      httpStatus: response.status,
      retryable: response.status >= 500,
    })
  }

  if (!body.ok) {
    const status = body.error_code ?? response.status
    throw new TelegramError(body.description ?? 'Telegram 接口调用失败', {
      code:
        status === 401
          ? 'unauthorized'
          : status === 429
            ? 'rate_limited'
            : 'api_error',
      httpStatus: status,
      retryable: status === 429 || status >= 500,
      retryAfter: body.parameters?.retry_after,
    })
  }

  return body.result as T
}

/* ---------------------------------------------------------------- methods */

export function getMe(token: string): Promise<TelegramMe> {
  return callBotApi<TelegramMe>(token, 'getMe')
}

export function sendMessage(
  token: string,
  params: SendMessageParams,
): Promise<TgMessage> {
  return callBotApi<TgMessage>(token, 'sendMessage', {
    chat_id: params.chatId,
    text: params.text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: params.disablePreview ?? true },
    ...(params.keyboard
      ? { reply_markup: { inline_keyboard: params.keyboard } }
      : {}),
  })
}

export function editMessageText(
  token: string,
  params: {
    chatId: string
    messageId: number
    text: string
    keyboard?: InlineKeyboard
  },
): Promise<TgMessage | true> {
  return callBotApi<TgMessage | true>(token, 'editMessageText', {
    chat_id: params.chatId,
    message_id: params.messageId,
    text: params.text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(params.keyboard
      ? { reply_markup: { inline_keyboard: params.keyboard } }
      : {}),
  })
}

export function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
): Promise<true> {
  return callBotApi<true>(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text: text.slice(0, 200) } : {}),
  })
}

export function setWebhook(
  token: string,
  params: { url: string; secretToken: string },
): Promise<true> {
  return callBotApi<true>(token, 'setWebhook', {
    url: params.url,
    secret_token: params.secretToken,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
    max_connections: 20,
  })
}

export function deleteWebhook(token: string): Promise<true> {
  return callBotApi<true>(token, 'deleteWebhook', {
    drop_pending_updates: false,
  })
}
