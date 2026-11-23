import { z } from 'zod'

import { AppError } from '#/server/errors'

export const DEFAULT_MAX_JSON_CHARS = 1024 * 1024

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  console.error('[api/v1]', error)
  return Response.json(
    {
      ok: false,
      error: { code: 'internal', message: '服务器内部错误，请稍后重试' },
    },
    { status: 500 },
  )
}

export function parseSchema<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  throw new AppError('validation_failed', '请求参数不合法', 400, result.error)
}

/**
 * 在解析前同时约束 Content-Length 与实际读取的 UTF-16 字符数。
 * 流式读取会在完整 JSON 进入内存前停止，不依赖请求方诚实上报长度。
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxChars = DEFAULT_MAX_JSON_CHARS,
): Promise<T> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const bytes = Number(contentLength)
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new AppError('validation_failed', 'Content-Length 不合法')
    }
    if (bytes > maxChars) {
      throw new AppError('validation_failed', '请求内容过大')
    }
  }

  let body: string
  try {
    body = await readLimitedText(request, maxChars)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('validation_failed', '无法读取请求内容')
  }

  let input: unknown
  try {
    input = JSON.parse(body)
  } catch {
    throw new AppError('validation_failed', '请求内容必须是合法 JSON')
  }
  return parseSchema(schema, input)
}

async function readLimitedText(
  request: Request,
  maxChars: number,
): Promise<string> {
  // Request.body is nullable for a request without a payload; empty input is invalid JSON.
  if (request.body === null) return ''

  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let done = false
  try {
    while (!done) {
      const chunk = await reader.read()
      done = chunk.done
      text += decoder.decode(chunk.value, { stream: !done })
      if (text.length > maxChars) {
        await reader.cancel()
        throw new AppError('validation_failed', '请求内容过大')
      }
    }
  } finally {
    reader.releaseLock()
  }
  if (text.length > maxChars) {
    throw new AppError('validation_failed', '请求内容过大')
  }
  return text
}

export const createMailboxSchema = z.object({
  kind: z.enum(['permanent', 'temp']),
  localPart: z.string().min(1).max(32),
  domainId: z.string().optional(),
  displayName: z.string().max(60).optional(),
})

export const apiCreateMailboxSchema = createMailboxSchema.extend({
  kind: createMailboxSchema.shape.kind.default('permanent'),
})

// 收件人总数在 sendMail 里按 to + cc + bcc 合并校验；这里只挡住超大载荷。
export const recipientField = z.union([
  z.string().max(4_000),
  z.array(z.string().max(320)).max(20),
])

export const sendSchema = z.object({
  fromMailboxId: z.string(),
  /** 调用方提供时稳定复用；缺省时先由服务端建立业务请求。 */
  idempotencyKey: z
    .string()
    .min(8)
    .max(200)
    .regex(/^[^\s/]+(?:\/[^\s/]+){0,4}$/, '幂等键格式不正确')
    .optional(),
  to: recipientField,
  cc: recipientField.optional(),
  bcc: recipientField.optional(),
  subject: z.string().max(200).optional(),
  text: z.string().max(100_000).optional(),
  html: z.string().max(200_000).optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(200),
        // 10MB 附件的 base64 约 13.4M 字符，留一点余量。
        content: z.string().max(14_000_000),
        contentType: z.string().max(100).optional(),
      }),
    )
    .max(3)
    .optional(),
})

/** 绑定邮箱的 API Key 可从作用域取得发件邮箱，不要求请求体重复提供。 */
export const apiSendSchema = sendSchema.extend({
  fromMailboxId: sendSchema.shape.fromMailboxId.optional(),
})

export const messageFolderSchema = z.enum([
  'inbox',
  'sent',
  'trash',
  'spam',
  'archive',
])

export const listMessagesSchema = z.object({
  mailboxId: z.string().optional(),
  folder: messageFolderSchema,
  q: z.string().max(100).optional(),
  cursor: z.string().optional(),
})

const optionalQueryString = <T>(schema: z.ZodType<T>) =>
  z.preprocess(
    (value) => (value === null || value === '' ? undefined : value),
    schema.optional(),
  )

export const apiMessagesQuerySchema = z.object({
  id: optionalQueryString(z.string().min(1).max(200)),
  mailboxId: optionalQueryString(z.string().min(1).max(200)),
  folder: optionalQueryString(messageFolderSchema).default('inbox'),
  q: optionalQueryString(z.string().max(100)),
  cursor: optionalQueryString(z.string().max(200)),
  limit: optionalQueryString(z.coerce.number().int().min(1).max(50)).default(
    30,
  ),
})

export const updateMessageSchema = z.object({
  id: z.string(),
  isRead: z.boolean().optional(),
  isStarred: z.boolean().optional(),
  folder: messageFolderSchema.optional(),
})
