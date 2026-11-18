import { eq } from 'drizzle-orm'

import { db } from '#/db/client'
import { domain, providerConfig } from '#/db/schema'
import { decryptSecret } from '#/server/crypto/secret-box'
import { AppError } from '#/server/errors'
import {
  getProvider,
  type MailProvider,
  type ProviderRuntimeConfig,
} from '#/server/providers'

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
  )[0]

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
    await db.select().from(domain).where(eq(domain.id, domainId)).limit(1)
  )[0]

  if (!row) throw new AppError('validation_failed', '域名不存在')
  if (row.status !== 'verified') {
    throw new AppError('validation_failed', '域名尚未通过验证，暂不能发信')
  }
  if (!row.sendingEnabled) {
    throw new AppError('validation_failed', '该域名未开启发信')
  }

  const resolved = await getProviderById(row.providerConfigId)
  if (!resolved.provider.capabilities.send) {
    throw new AppError(
      'not_implemented',
      `${resolved.config.label} 尚未支持发信`,
      501,
    )
  }
  return resolved
}
