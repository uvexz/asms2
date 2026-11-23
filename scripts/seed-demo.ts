/**
 * 仅用于本地界面验收：写入一个假服务商、一个演示域名和两个邮箱。
 * 生产环境不要执行；假 Key 无法真正发信，只用于跑通 UI。
 * 运行：bunx tsx scripts/seed-demo.ts
 */
import '#/server/env'

import { eq } from 'drizzle-orm'

import { db } from '#/db/client'
import { domain, mailbox, providerConfig, user } from '#/db/schema'
import { encryptSecret } from '#/server/crypto/secret-box'
import { createMailbox, listMailboxes } from '#/server/mail/mailbox'

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境禁止执行 seed-demo')
  }
  const admins = await db
    .select()
    .from(user)
    .where(eq(user.role, 'admin'))
    .limit(1)
  if (admins.length === 0) throw new Error('no admin user')
  const admin = admins[0]

  const configs = await db.select().from(providerConfig).limit(1)
  let config = configs[0]
  if (configs.length === 0) {
    const id = 'demo-provider'
    await db.insert(providerConfig).values({
      id,
      kind: 'resend',
      label: 'Resend 演示',
      apiKeyEnc: encryptSecret('re_demo_key_not_real'),
      apiKeyLast4: 'real',
      isDefaultForSend: true,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    config = (await db.select().from(providerConfig).limit(1))[0]
  }

  const domains = await db.select().from(domain).limit(1)
  let dom = domains[0]
  if (domains.length === 0) {
    await db.insert(domain).values({
      id: 'demo-domain',
      hostname: 'demo.asms2.local',
      providerConfigId: config.id,
      providerDomainId: 'demo-provider-domain',
      status: 'verified',
      receivingEnabled: true,
      sendingEnabled: true,
      isDefaultPermanent: true,
      isDefaultTemp: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    dom = (await db.select().from(domain).limit(1))[0]
  }

  const existing = await db
    .select()
    .from(mailbox)
    .where(eq(mailbox.userId, admin.id))
  if (existing.length === 0) {
    await createMailbox(admin.id, {
      kind: 'permanent',
      localPart: 'hello',
      domainId: dom.id,
    })
    await createMailbox(admin.id, {
      kind: 'temp',
      localPart: 'temp12345678',
      domainId: dom.id,
    })
  }

  console.log(JSON.stringify(await listMailboxes(admin.id), null, 2))
}

void main()
