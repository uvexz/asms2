import { and, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'

import { db } from '#/db/client'
import { domain, mailbox, message } from '#/db/schema'
import { AppError } from '#/server/errors'
import { getSiteSettings } from '#/server/settings'
import { MAILBOX_LIST_LIMIT } from '#/lib/limits'

import { validateLocalPart } from './address'
import {
  isAddressConflict,
  quotaHourBucket,
  releaseMailboxQuota,
  reserveMailboxQuotaOrThrow,
  softDeleteMailbox,
  TEMP_MAILBOXES_PER_HOUR,
} from './mailbox-quota'

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

/** 临时邮箱未收到邮件而失效后不再出现在列表中；已保留的（retained）例外 */
function isVisible(item: MailboxView) {
  return !(item.kind === 'temp' && !item.retained && item.status === 'expired')
}

/** 侧栏邮箱列表：上限见 MAILBOX_LIST_LIMIT，未读数用一条 GROUP BY 聚合 */
export async function listMailboxes(
  userId: string,
  offset = 0,
): Promise<MailboxView[]> {
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
    })
    .from(mailbox)
    .leftJoin(domain, eq(domain.id, mailbox.domainId))
    .where(and(eq(mailbox.userId, userId), ne(mailbox.status, 'deleted')))
    .orderBy(desc(mailbox.createdAt), desc(mailbox.id))
    .limit(MAILBOX_LIST_LIMIT)
    .offset(offset)

  if (rows.length === 0) return []

  // 未读数用一条 GROUP BY 聚合，避免每个邮箱各跑一次相关子查询
  const unreadRows = await db
    .select({
      mailboxId: message.mailboxId,
      count: sql<number>`count(*)`,
    })
    .from(message)
    .where(
      and(
        inArray(
          message.mailboxId,
          rows.map((row) => row.id),
        ),
        eq(message.folder, 'inbox'),
        eq(message.isRead, false),
      ),
    )
    .groupBy(message.mailboxId)

  const unreadByMailbox = new Map(
    unreadRows.map((row) => [row.mailboxId, Number(row.count)]),
  )

  return rows
    .map((row) => toView({ ...row, unread: unreadByMailbox.get(row.id) ?? 0 }))
    .filter(isVisible)
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
  ).at(0)

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

async function resolveDomain(kind: MailboxKind, domainId: string | undefined) {
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
      desc(kind === 'temp' ? domain.isDefaultTemp : domain.isDefaultPermanent),
      desc(domain.createdAt),
    )
    .limit(1)

  const found = rows.at(0)
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
  /** 管理员放行保留前缀（如 admin@），普通用户始终禁止 */
  allowReserved?: boolean
}

export async function createMailbox(
  userId: string,
  input: CreateMailboxInput,
): Promise<MailboxView> {
  const settings = await getSiteSettings()
  const localPart = validateLocalPart(input.localPart, input.kind, settings, {
    allowReserved: input.allowReserved,
  })
  // 关闭域名选择时强制使用站点默认域,API 也不能绕过
  const targetDomain = await resolveDomain(
    input.kind,
    settings.allowUserDomainChoice ? input.domainId : undefined,
  )

  const now = Date.now()
  const mailboxId = idPart()
  const limit =
    input.kind === 'permanent'
      ? (input.mailboxLimit ?? settings.defaultMailboxLimit)
      : TEMP_MAILBOXES_PER_HOUR
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
  ).at(0)
  if (tombstone) {
    throw new AppError('address_taken', '该地址刚被释放，冷却期内不可注册', 409)
  }

  const address = `${localPart}@${targetDomain.hostname}`
  const expiresAt =
    input.kind === 'temp'
      ? new Date(now + settings.tempTtlMinutes * 60 * 1000)
      : null

  await reserveMailboxQuotaOrThrow({
    userId,
    kind: input.kind,
    mailboxId,
    limit,
    hourBucket: quotaHourBucket(now),
  })

  try {
    const inserted = await db
      .insert(mailbox)
      .values({
        id: mailboxId,
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
    // 地址冲突/写入失败时释放预占，避免占用名额直到下一次 sweep。
    await releaseMailboxQuota(mailboxId).catch(() => undefined)
    if (isAddressConflict(error)) {
      throw new AppError('address_taken', '该地址已被占用', 409)
    }
    throw error
  }
}

export async function removeMailbox(userId: string, mailboxId: string) {
  const row = await getMailboxOrThrow(userId, mailboxId, {
    allowExpired: true,
  })
  await softDeleteMailbox({
    id: row.id,
    address: row.address,
    kind: row.kind,
  })

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
      desc(kind === 'temp' ? domain.isDefaultTemp : domain.isDefaultPermanent),
      desc(domain.createdAt),
    )
  return rows
}
