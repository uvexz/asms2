import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const databasePath = process.env.DATABASE_URL
if (!databasePath || !databasePath.startsWith('file:/tmp/asms2-regression-')) {
  throw new Error('DATABASE_URL 必须指向 /tmp/asms2-regression-* 独立测试库')
}
for (const suffix of ['', '-shm', '-wal']) {
  rmSync(databasePath.slice('file:'.length) + suffix, { force: true })
}

const migration = spawnSync('bun', ['run', 'db:migrate'], {
  cwd: process.cwd(),
  env: process.env,
  encoding: 'utf8',
})
assert.equal(migration.status, 0, migration.stdout + migration.stderr)

const { db } = await import('#/db/client')
const {
  dailyUsage,
  domain,
  message,
  messageBody,
  outboundRequest,
  providerConfig,
  siteSettings,
  telegramBot,
  telegramUpdate,
  user,
} = await import('#/db/schema')
const { encryptSecret } = await import('#/server/crypto/secret-box')
const { createMailbox, listMailboxes, removeMailbox } =
  await import('#/server/mail/mailbox')
const { getSiteSettings } = await import('#/server/settings')
const { formatAddress } = await import('#/lib/email-address')
const { getProvider, ProviderError } = await import('#/server/providers')
const { sendMail } = await import('#/server/mail/send')
const { sweep } = await import('#/server/jobs/sweep')
const { handleTelegramUpdate } = await import('#/server/telegram/update')
const { eq } = await import('drizzle-orm')

const { randomNameLocalPart } = await import('#/lib/name-prefix')
const generated = new Set<string>()
for (let index = 0; index < 500; index += 1) {
  const prefix = randomNameLocalPart({ minLength: 8, maxLength: 32 })
  assert.match(prefix, /^[a-z0-9]{8,32}$/)
  generated.add(prefix)
}
assert.equal(generated.size, 500)
console.log('PASS random prefixes are opaque CSPRNG output')

const providerId = 'regression-provider'
const domainId = 'regression-domain'
await db.batch([
  db.insert(providerConfig).values({
    id: providerId,
    kind: 'resend',
    label: 'stub',
    apiKeyEnc: encryptSecret('not-a-real-provider-key'),
  }),
  db.insert(domain).values({
    id: domainId,
    hostname: 'regression.test',
    providerConfigId: providerId,
    status: 'verified',
    receivingEnabled: true,
    sendingEnabled: true,
  }),
  db.update(siteSettings).set({ allowTempSend: true }),
])

async function createUser(id: string, mailboxLimit: number, sendLimit = 10) {
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@resend.dev`,
    emailVerified: true,
    mailboxLimit,
    sendLimit,
    createdAt: new Date(Date.now() - 48 * 3_600_000),
  })
}

await createUser('limit-user', 5)
await createUser('temp-user', 0)
await createUser('send-user', 20)

const mailboxResults = await Promise.allSettled(
  Array.from({ length: 10 }, (_, index) =>
    createMailbox('limit-user', {
      kind: 'permanent',
      localPart: `parallel${index}`,
    }),
  ),
)
assert.equal(
  mailboxResults.filter((result) => result.status === 'fulfilled').length,
  5,
  mailboxResults.map((result) => String(result)).join('\n'),
)
console.log('PASS permanent mailbox concurrent limit')

const tempResults = await Promise.allSettled(
  Array.from({ length: 24 }, (_, index) =>
    createMailbox('temp-user', {
      kind: 'temp',
      localPart: `temporary${index}`,
    }),
  ),
)
assert.equal(
  tempResults.filter((result) => result.status === 'fulfilled').length,
  20,
  tempResults.map((result) => String(result)).join('\n'),
)
console.log('PASS temporary mailbox hour limit')

// 删除 temp 不能归还小时配额,否则可以 20 个 → 删 1 个 → 第 21 个继续创建。
const tempBoxes = tempResults.flatMap((result) =>
  result.status === 'fulfilled' ? [result.value] : [],
)
await removeMailbox('temp-user', tempBoxes[0].id)
await assert.rejects(
  createMailbox('temp-user', {
    kind: 'temp',
    localPart: 'temporaryextra',
  }),
  (error: unknown) => (error as { code?: string }).code === 'rate_limited',
)
console.log('PASS deleting a temp mailbox does not reset hourly creation limit')

// 重复地址必须映射成 409,而不是被 Drizzle 包装后的 500。
await createMailbox('send-user', {
  kind: 'permanent',
  localPart: 'dupcase',
})
await assert.rejects(
  createMailbox('send-user', {
    kind: 'permanent',
    localPart: 'dupcase',
  }),
  (error: unknown) => (error as { code?: string }).code === 'address_taken',
)
console.log('PASS duplicate address maps to address_taken')

// 冷却期为 0 时,软删后的地址应该可以立即重新注册。
await db
  .update(siteSettings)
  .set({ tempCooldownHours: 0 })
  .where(eq(siteSettings.id, 'default'))
await getSiteSettings(true)
const reusable = await createMailbox('limit-user', {
  kind: 'temp',
  localPart: 'reusecase',
})
await removeMailbox('limit-user', reusable.id)
const reused = await createMailbox('limit-user', {
  kind: 'temp',
  localPart: 'reusecase',
})
assert.equal(reused.address, reusable.address)
console.log('PASS soft-deleted address can be reused after cooldown')

// 显示名不能把 CR/LF 或收件人分隔符带进 From 头。
const formatted = formatAddress({
  address: 'a@example.com',
  name: 'x\r\nBcc: victim@example.com, y',
})
assert.equal(formatted.includes('\r'), false)
assert.equal(formatted.includes('\n'), false)
assert.equal(formatted.includes(','), false)
console.log('PASS display name is sanitized before formatting From header')

// 邮箱列表支持 offset,侧栏分页可以继续取后面的邮箱。
const paged = await listMailboxes('limit-user', 50)
assert.equal(paged.length, 0)
console.log('PASS mailbox list supports offset pagination')

// 关闭域名选择时,服务端忽略客户端传来的 domainId,强制默认域。
await db.insert(domain).values({
  id: 'second-domain',
  hostname: 'second.example.com',
  providerConfigId: providerId,
  status: 'verified',
  receivingEnabled: true,
  sendingEnabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
})
await db
  .update(domain)
  .set({ isDefaultTemp: true })
  .where(eq(domain.id, domainId))
await db
  .update(siteSettings)
  .set({ allowUserDomainChoice: false })
  .where(eq(siteSettings.id, 'default'))
await getSiteSettings(true)
const forced = await createMailbox('send-user', {
  kind: 'temp',
  localPart: 'forceddefault',
  domainId: 'second-domain',
})
assert.equal(forced.address.endsWith('@regression.test'), true)
console.log('PASS disabled domain choice forces the default domain')

const sendMailbox = await createMailbox('send-user', {
  kind: 'permanent',
  localPart: 'outboundreg',
})
const actor = {
  id: 'send-user',
  name: 'send-user',
  email: 'send-user@resend.dev',
  role: 'user',
  emailVerified: true,
}

const provider = getProvider('resend')
const originalSend = provider.send
let providerCalls = 0
let mode: 'ok' | 'reject' | 'unknown' | 'rate-limit' = 'ok'
provider.send = async () => {
  providerCalls += 1
  if (mode === 'reject') {
    throw new ProviderError('stub rejected payload', { retryable: false })
  }
  if (mode === 'unknown') {
    throw new ProviderError('stub timeout', { retryable: true })
  }
  if (mode === 'rate-limit') {
    throw new ProviderError('stub 429', {
      retryable: true,
      httpStatus: 429,
    })
  }
  return {
    providerMessageId: `stub-provider-message-${providerCalls}`,
    status: 'sent',
  }
}

const input = {
  fromMailboxId: sendMailbox.id,
  to: 'delivered@resend.dev',
  text: 'only in isolated test',
  idempotencyKey: 'regression-send-1',
}

const concurrent = await Promise.all([
  sendMail(actor, input),
  sendMail(actor, input),
])
assert.equal(providerCalls, 1)
assert.equal(concurrent[0].id, concurrent[1].id)
assert.equal((await db.select().from(message)).length, 1)
assert.equal((await db.select().from(dailyUsage))[0]?.sentCount, 1)
console.log('PASS same-key concurrent send: one provider call, one message')

await assert.rejects(
  sendMail(actor, { ...input, text: 'different content' }),
  (error: unknown) => (error as { code?: string }).code === 'conflict',
)
assert.equal(providerCalls, 1)
console.log('PASS same key with different payload returns 409')

mode = 'reject'
await assert.rejects(
  sendMail(actor, {
    ...input,
    idempotencyKey: 'regression-failure-1',
  }),
  (error: unknown) => (error as { code?: string }).code === 'provider_error',
)
assert.equal(providerCalls, 2)
assert.equal((await db.select().from(dailyUsage))[0]?.sentCount, 1)
console.log('PASS definitive provider rejection refunds quota')

// 模拟服务商已受理，但进程在写入本地 message 前退出。
mode = 'ok'
const firstRequest = (
  await db
    .select()
    .from(outboundRequest)
    .where(eq(outboundRequest.mailboxId, sendMailbox.id))
)[0]
await db.delete(messageBody).where(eq(messageBody.messageId, firstRequest.id))
await db.delete(message).where(eq(message.id, firstRequest.id))
await db
  .update(outboundRequest)
  .set({ status: 'submitted', messageId: null })
  .where(eq(outboundRequest.id, firstRequest.id))

const recovered = await sendMail(actor, input)
assert.equal(recovered.id, firstRequest.id)
assert.equal(providerCalls, 2, 'recovery must not call provider again')
assert.equal((await db.select().from(message)).length, 1)
console.log('PASS accepted provider result recovers locally without resending')

// 结果未知（无服务商 ID）必须拒绝盲目重发。
await db
  .update(outboundRequest)
  .set({ status: 'uncertain', providerMessageId: null })
  .where(eq(outboundRequest.id, firstRequest.id))
await assert.rejects(
  sendMail(actor, input),
  (error: unknown) => (error as { code?: string }).code === 'send_uncertain',
)
assert.equal(providerCalls, 2)
console.log('PASS unknown result does not automatically resend')

// 429 明确未受理:同键重试应重新派发,而不是永久卡在 uncertain。
mode = 'rate-limit'
const retryKey = 'regression-rate-limit-1'
await assert.rejects(
  sendMail(actor, { ...input, idempotencyKey: retryKey }),
  (error: unknown) =>
    (error as { code?: string }).code === 'provider_retryable',
)
assert.equal(providerCalls, 3)
mode = 'ok'
const retried = await sendMail(actor, { ...input, idempotencyKey: retryKey })
assert.ok(retried.providerMessageId)
assert.equal(providerCalls, 4)
assert.equal((await db.select().from(dailyUsage))[0]?.sentCount, 2)
console.log('PASS 429 can be retried with the same idempotency key')

// Telegram：第一次发送回复失败应可重投，第二次成功后才标记 processed。
await db.insert(telegramBot).values({
  id: 'default',
  enabled: true,
  botTokenEnc: encryptSecret('fake-telegram-bot-token'),
  botUsername: 'regression_bot',
})
const originalFetch = globalThis.fetch
let telegramAttempt = 0
globalThis.fetch = async () => {
  telegramAttempt += 1
  if (telegramAttempt === 1) {
    return new Response(
      JSON.stringify({
        ok: false,
        error_code: 500,
        description: 'stub failure',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  return new Response(
    JSON.stringify({
      ok: true,
      result: { message_id: 1, date: 1, chat: { id: 5, type: 'private' } },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}
const update = {
  update_id: 9001,
  message: {
    message_id: 1,
    date: 1,
    chat: { id: 5, type: 'private' as const },
    from: { id: 5, is_bot: false, first_name: 'tester' },
    text: '/help',
  },
}
await assert.rejects(handleTelegramUpdate(update))
let tgRows = await db.select().from(telegramUpdate)
assert.equal(tgRows[0]?.status, 'failed')
await handleTelegramUpdate(update)
tgRows = await db.select().from(telegramUpdate)
assert.equal(tgRows[0]?.status, 'processed')
assert.equal(tgRows[0]?.attempts, 2)
globalThis.fetch = originalFetch
console.log('PASS Telegram failed update can be retried and then processed')

provider.send = originalSend
await sweep()
console.log('PASS sweep runs on migrated fixtures')
console.log('REGRESSION SUITE PASSED')
