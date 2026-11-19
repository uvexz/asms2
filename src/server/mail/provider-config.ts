import { eq } from 'drizzle-orm'

import { db } from '#/db/client'
import { domain, providerConfig } from '#/db/schema'
import { decryptSecret } from '#/server/crypto/secret-box'
import { AppError } from '#/server/errors'
import { getProvider } from '#/server/providers'
import type { MailProvider, ProviderRuntimeConfig } from '#/server/providers'

export interface ResolvedProvider {
  provider: MailProvider
  config: typeof providerConfig.$inferSelect
  runtime: ProviderRuntimeConfig
}

export async function getProviderById(
  providerConfigId: string,
): Promise<ResolvedProvider> {
  const row = (
    await db
      .select()
      .from(providerConfig)
      .where(eq(providerConfig.id, providerConfigId))
      .limit(1)
  ).at(0)

  if (!row) {
    throw new AppError('provider_error', '服务商配置不存在', 500)
  }
  if (row.status !== 'active') {
    throw new AppError('provider_error', '服务商已被停用', 503)
  }

  return {
    provider: getProvider(row.kind),
    config: row,
    runtime: {
      apiKey: decryptSecret(row.apiKeyEnc),
      apiBaseUrl: row.apiBaseUrl,
      accountId: row.externalAccountId,
    },
  }
}

/** 发信必须走域名绑定的服务商，且域名已通过验证并开启发信 */
export async function resolveSendProviderForDomain(
  domainId: string,
): Promise<ResolvedProvider> {
  const row = (
    await db
      .select({ domain, config: providerConfig })
      .from(domain)
      .innerJoin(providerConfig, eq(providerConfig.id, domain.providerConfigId))
      .where(eq(domain.id, domainId))
      .limit(1)
  ).at(0)

  if (!row) throw new AppError('validation_failed', '域名不存在')
  if (row.domain.status !== 'verified') {
    throw new AppError('validation_failed', '域名尚未通过验证，暂不能发信')
  }
  if (!row.domain.sendingEnabled) {
    throw new AppError('validation_failed', '该域名未开启发信')
  }
  if (row.config.status !== 'active') {
    throw new AppError('provider_error', '服务商已被停用', 503)
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
    provider,
    config: row.config,
    runtime: {
      apiKey: decryptSecret(row.config.apiKeyEnc),
      apiBaseUrl: row.config.apiBaseUrl,
      accountId: row.config.externalAccountId,
    },
  }
}
