import { randomUUID } from 'node:crypto'

import { and, asc, desc, eq } from 'drizzle-orm'

import { db } from '#/db/client'
import { domain, providerConfig } from '#/db/schema'
import { decryptSecret } from '#/server/crypto/secret-box'
import { AppError } from '#/server/errors'
import { getProvider, ProviderError } from '#/server/providers'
import { getSiteSettings } from '#/server/settings'

import { textToHtml } from './content'

export interface SystemMailInput {
  to: string
  subject: string
  text: string
  html?: string
}

/** 系统邮件（验证邮箱等）走默认发信服务商 + 已验证且开启发信的域名 */
type SenderRow = {
  domain: typeof domain.$inferSelect
  config: typeof providerConfig.$inferSelect
}

async function resolveSystemSender() {
  const rows = await db
    .select({ domain, config: providerConfig })
    .from(domain)
    .innerJoin(providerConfig, eq(providerConfig.id, domain.providerConfigId))
    .where(
      and(
        eq(domain.status, 'verified'),
        eq(domain.sendingEnabled, true),
        eq(providerConfig.status, 'active'),
      ),
    )
    .orderBy(
      desc(domain.isDefaultPermanent),
      desc(domain.isDefaultTemp),
      asc(domain.createdAt),
    )
    .limit(1)

  const row: SenderRow | undefined = rows.at(0)
  if (!row) {
    throw new AppError(
      'validation_failed',
      '请先在「服务商」配置可发信的已验证域名',
      400,
    )
  }

  const provider = getProvider(row.config.kind)
  if (!provider.capabilities.send) {
    throw new AppError(
      'not_implemented',
      `${row.config.label} 尚未支持发信`,
      501,
    )
  }

  return {
    hostname: row.domain.hostname,
    provider,
    runtime: {
      apiKey: decryptSecret(row.config.apiKeyEnc),
      apiBaseUrl: row.config.apiBaseUrl,
      accountId: row.config.externalAccountId,
    },
  }
}

export async function canSendSystemMail(): Promise<boolean> {
  try {
    await resolveSystemSender()
    return true
  } catch {
    return false
  }
}

export async function sendSystemMail(input: SystemMailInput): Promise<void> {
  const [sender, settings] = await Promise.all([
    resolveSystemSender(),
    getSiteSettings(),
  ])

  try {
    await sender.provider.send(
      {
        from: {
          address: `noreply@${sender.hostname}`,
          name: settings.siteName,
        },
        to: [{ address: input.to }],
        subject: input.subject,
        text: input.text,
        html: input.html ?? textToHtml(input.text),
        idempotencyKey: `system/${randomUUID()}`,
      },
      sender.runtime,
    )
  } catch (error) {
    if (error instanceof ProviderError) {
      throw new AppError(
        'provider_error',
        `系统邮件发送失败：${error.message}`,
        502,
      )
    }
    throw error
  }
}
