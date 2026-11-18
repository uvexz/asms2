import { resendProvider } from './resend'
import type { MailProvider } from './types'

/**
 * 兼容 Resend 协议的自定义网关。apiBaseUrl 必填，其余行为与 Resend 一致。
 *
 * 只适用于「真的实现了 Resend 协议」的网关：`POST /emails`、Svix 验签头
 * （`svix-id` / `svix-timestamp` / `svix-signature`）、`/emails/receiving/{id}`。
 * Groundmail 虽然发信接口长得像 Resend，但验签与入站接口都不同，走
 * `groundmail.ts` 而不是这里。
 */
export const customProvider: MailProvider = {
  ...resendProvider,
  kind: 'custom',
}
