/**
 * 全站 query key 的唯一来源。
 *
 * 组件里不再写 `['admin', 'webhooks']` 这类裸字面量：拼错不会报错，只会新增一个
 * 永远不会被失效的缓存条目。失效时用 `.all` / 无参形式做前缀匹配。
 */

export type MailFolder = 'inbox' | 'sent' | 'trash' | 'spam' | 'archive'

export interface MessageListFilters {
  mailboxId?: string
  folder: MailFolder
  q?: string
}

export const queryKeys = {
  session: ['session'] as const,
  publicLoginConfig: ['public-login-config'] as const,
  mailboxes: ['mailboxes'] as const,
  quota: ['quota'] as const,
  domains: (kind: 'permanent' | 'temp') => ['domains', kind] as const,

  messages: {
    /** 前缀：命中所有筛选条件 */
    all: ['messages'] as const,
    list: (filters: MessageListFilters) => ['messages', filters] as const,
  },

  message: {
    all: ['message'] as const,
    detail: (id: string) => ['message', id] as const,
  },

  apiKeys: ['api-keys'] as const,
  telegramStatus: ['telegram', 'status'] as const,
  ssoAccounts: ['sso-accounts'] as const,

  admin: {
    all: ['admin'] as const,
    overview: ['admin', 'overview'] as const,
    users: {
      all: ['admin', 'users'] as const,
      list: (search: string, offset: number) =>
        ['admin', 'users', search, offset] as const,
    },
    audit: (offset: number) => ['admin', 'audit', offset] as const,
    webhookEvents: (offset: number) =>
      ['admin', 'webhook-events', offset] as const,
    unrouted: (offset: number) => ['admin', 'unrouted', offset] as const,
    domains: ['admin', 'domains'] as const,
    providers: ['admin', 'providers'] as const,
    webhooks: ['admin', 'webhooks'] as const,
    site: ['admin', 'site'] as const,
    loginMethods: ['admin', 'login-methods'] as const,
    telegram: ['admin', 'telegram'] as const,
  },
}
