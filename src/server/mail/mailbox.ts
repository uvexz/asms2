import { and, desc, eq, gt, ne, sql } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'

import { db } from '#/db/client'
import { domain, mailbox } from '#/db/schema'
import { AppError } from '#/server/errors'
import { getSiteSettings } from '#/server/settings'

import { validateLocalPart } from './address'

const idPart = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 20)

export type MailboxKind = 'permanent' | 'temp'
export type MailboxStatus = 'active' | 'expired' | 'disabled' | 'deleted'

export interface MailboxView {
  id: string
  address: string
  localPart: string
  displayName: string | null
  kind: MailboxKind
  status: MailboxStatus
  domainId: string
  domain: string
  expiresAt: number | null
  retained: boolean
  lastReceivedAt: number | null
  createdAt: number
  unreadCount: number
}

function toView(row: {
  id: string
  address: string
  localPart: string
  displayName: string | null
  kind: MailboxKind
  status: MailboxStatus
  domainId: string
  domain: string | null
  expiresAt: Date | null
  retainedAt?: Date | null
  lastReceivedAt: Date | null
  createdAt: Date
  unread: number | string | null
}): MailboxView {
  const now = Date.now()
  const expiresAt = row.expiresAt ? row.expiresAt.getTime() : null
  const retained = row.kind === 'temp' && Boolean(row.retainedAt)
  const status: MailboxStatus =
    row.kind === 'temp' && expiresAt !== null && expiresAt <= now
      ? 'expired'
      : row.status

  return {
    id: row.id,
    address: row.address,
    localPart: row.localPart,
    displayName: row.displayName,
    kind: row.kind,
    status,
    domainId: row.domainId,
    domain: row.domain ?? '',
    expiresAt,
    retained,
    lastReceivedAt: row.lastReceivedAt ? row.lastReceivedAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
    unreadCount: Number(row.unread ?? 0),
  }
}

export async function listMailboxes(userId: string): Promise<MailboxView[]> {
  const rows = await db
    .select({
      id: mailbox.id,
      address: mailbox.address,
      localPart: mailbox.localPart,
      displayName: mailbox.displayName,
      kind: mailbox.kind,
      status: mailbox.status,
      domainId: mailbox.domainId,
      domain: domain.hostname,
      expiresAt: mailbox.expiresAt,
      retainedAt: mailbox.retainedAt,
      lastReceivedAt: mailbox.lastReceivedAt,
      createdAt: mailbox.createdAt,
      unread: sql<number>`(
        select count(*) from message m
        where m.mailbox_id = ${mailbox.id}
          and m.folder = 'inbox'
          and m.is_read = 0
      )`,
    })
    .from(mailbox)
    .leftJoin(domain, eq(domain.id, mailbox.domainId))
    .where(and(eq(mailbox.userId, userId), ne(mailbox.status, 'deleted')))
    .orderBy(desc(mailbox.createdAt))

  return rows.map(toView)
}

export async function getMailboxOrThrow(
  userId: string,
  mailboxId: string,
  options: { allowExpired?: boolean } = {},
) {
  const row = (
    await db
      .select()
      .from(mailbox)
      .where(and(eq(mailbox.id, mailboxId), eq(mailbox.userId, userId)))
      .limit(1)
  )[0]

  if (!row || row.status === 'deleted') {
    throw new AppError('not_found', '邮箱不存在', 404)
  }
  if (row.status === 'disabled') {
    throw new AppError('forbidden', '该邮箱已被停用', 403)
  }
  if (
    !options.allowExpired &&
    row.kind === 'temp' &&
    row.expiresAt !== null &&
    row.expiresAt.getTime() <= Date.now()
  ) {
    throw new AppError('not_found', '临时邮箱已失效', 410)
  }

  return row
}

async function resolveDomain(
  kind: MailboxKind,
  domainId: string | undefined,
) {
  const conditions = [
    eq(domain.status, 'verified'),
    eq(domain.receivingEnabled, true),
    kind === 'temp'
      ? eq(domain.allowTempCreate, true)
      : eq(domain.allowPermanentCreate, true),
  ]
  if (domainId) conditions.push(eq(domain.id, domainId))

  const rows = await db
    .select()
    .from(domain)
    .where(and(...conditions))
    .orderBy(
      desc(
        kind === 'temp' ? domain.isDefaultTemp : domain.isDefaultPermanent,
      ),
      desc(domain.createdAt),
    )
    .limit(1)

  const found = rows[0]
  if (!found) {
    throw new AppError(
      'validation_failed',
      kind === 'temp'
        ? '没有可用于新建临时邮箱的域名，请联系管理员开启'
        : '没有可用于新建长期邮箱的域名，请联系管理员开启',
      400,
    )
  }
  return found
}

export interface CreateMailboxInput {
  kind: MailboxKind
  localPart: string
  domainId?: string
  displayName?: string
  mailboxLimit?: number | null
}

export async function createMailbox(
  userId: string,
  input: CreateMailboxInput,
): Promise<MailboxView> {
  const settings = await getSiteSettings()
  const localPart = validateLocalPart(input.localPart, input.kind, settings)
  const targetDomain = await resolveDomain(input.kind, input.domainId)

  const now = Date.now()

  if (input.kind === 'permanent') {
    const limit = input.mailboxLimit ?? settings.defaultMailboxLimit
    const countRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(mailbox)
      .where(
        and(
          eq(mailbox.userId, userId),
          eq(mailbox.kind, 'permanent'),
          ne(mailbox.status, 'deleted'),
        ),
      )
    const count = Number(countRows[0]?.count ?? 0)
    if (count >= limit) {
      throw new AppError(
        'mailbox_limit_reached',
        `长期邮箱已达上限（${limit} 个），请先删除不再使用的邮箱`,
        409,
      )
    }
  } else {
    const recent = await db
      .select({ count: sql<number>`count(*)` })
      .from(mailbox)
      .where(
        and(
          eq(mailbox.userId, userId),
          eq(mailbox.kind, 'temp'),
          gt(mailbox.createdAt, new Date(now - 60 * 60 * 1000)),
        ),
      )
    if (Number(recent[0]?.count ?? 0) >= 20) {
      throw new AppError(
        'rate_limited',
        '临时邮箱创建过于频繁，请稍后再试',
        429,
      )
    }
  }

  // 冷却期检查：地址被删除/失效后一段时间内不允许被任何人重新注册
  const cooldownMs =
    (input.kind === 'temp'
      ? settings.tempCooldownHours * 3600
      : settings.permanentCooldownDays * 86400) * 1000
  const tombstone = (
    await db
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(
        and(
          eq(mailbox.domainId, targetDomain.id),
          eq(mailbox.localPart, localPart),
          eq(mailbox.status, 'deleted'),
          gt(mailbox.deletedAt, new Date(now - cooldownMs)),
        ),
      )
      .limit(1)
  )[0]
  if (tombstone) {
    throw new AppError('address_taken', '该地址刚被释放，冷却期内不可注册', 409)
  }

  const address = `${localPart}@${targetDomain.hostname}`
  const expiresAt =
    input.kind === 'temp'
      ? new Date(now + settings.tempTtlMinutes * 60 * 1000)
      : null

  try {
    const inserted = await db
      .insert(mailbox)
      .values({
        id: idPart(),
        userId,
        domainId: targetDomain.id,
        localPart,
        address,
        displayName: input.displayName ?? null,
        kind: input.kind,
        status: 'active',
        expiresAt,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .returning()

    const row = inserted[0]
    return toView({ ...row, domain: targetDomain.hostname, unread: 0 })
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      throw new AppError('address_taken', '该地址已被占用', 409)
    }
    throw error
  }
}

export async function removeMailbox(userId: string, mailboxId: string) {
  const row = await getMailboxOrThrow(userId, mailboxId, {
    allowExpired: true,
  })
  const now = new Date()

  // 软删 + 墓碑化地址（保留原 localPart 供冷却期判断，同时释放唯一索引）
  await db
    .update(mailbox)
    .set({
      status: 'deleted',
      address: `${row.address}#${row.id}`,
      expiresAt: null,
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(mailbox.id, row.id))

  return { id: row.id }
}

export async function updateMailboxProfile(
  userId: string,
  mailboxId: string,
  patch: { displayName?: string | null },
) {
  const row = await getMailboxOrThrow(userId, mailboxId)
  await db
    .update(mailbox)
    .set({ displayName: patch.displayName ?? null, updatedAt: new Date() })
    .where(eq(mailbox.id, row.id))
}

/**
 * 临时邮箱在考察期内收到了邮件：永久保留。
 * 置空 expiresAt 让清理任务不再扫描它，retainedAt 作为「已激活」的标记。
 */
export async function retainTempMailbox(
  mailboxId: string,
  receivedAt: Date,
) {
  const now = new Date()
  await db
    .update(mailbox)
    .set({
      expiresAt: null,
      retainedAt: receivedAt,
      lastReceivedAt: receivedAt,
      updatedAt: now,
    })
    .where(eq(mailbox.id, mailboxId))
}

export async function listSelectableDomains(kind: MailboxKind) {
  const rows = await db
    .select({
      id: domain.id,
      hostname: domain.hostname,
      isDefaultPermanent: domain.isDefaultPermanent,
      isDefaultTemp: domain.isDefaultTemp,
    })
    .from(domain)
    .where(
      and(
        eq(domain.status, 'verified'),
        eq(domain.receivingEnabled, true),
        kind === 'temp'
          ? eq(domain.allowTempCreate, true)
          : eq(domain.allowPermanentCreate, true),
      ),
    )
    .orderBy(
      desc(
        kind === 'temp' ? domain.isDefaultTemp : domain.isDefaultPermanent,
      ),
    )
  return rows
}
