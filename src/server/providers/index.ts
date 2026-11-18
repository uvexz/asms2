import { ahasendProvider } from './ahasend'
import { customProvider } from './custom'
import { groundmailProvider } from './groundmail'
import { mailtrapProvider } from './mailtrap'
import { plunkProvider } from './plunk'
import { reloopProvider } from './reloop'
import { resendProvider } from './resend'
import { unitpostProvider } from './unitpost'
import type { MailProvider, ProviderKind } from './types'

export * from './types'

/**
 * 适配层只认 MailProvider 接口。新增服务商 = 新增一个实现 + 在这里注册，
 * 业务层不需要任何改动。
 */
const registry: Record<ProviderKind, MailProvider> = {
  resend: resendProvider,
  unitpost: unitpostProvider,
  ahasend: ahasendProvider,
  groundmail: groundmailProvider,
  mailtrap: mailtrapProvider,
  plunk: plunkProvider,
  reloop: reloopProvider,
  custom: customProvider,
}

export function getProvider(kind: ProviderKind): MailProvider {
  return registry[kind] ?? registry.resend
}

export function listProviders(): MailProvider[] {
  return Array.from(new Set(Object.values(registry)))
}
