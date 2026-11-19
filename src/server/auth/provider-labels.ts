/**
 * `account.provider_id` 与展示名的映射。
 *
 * 内置方式（Better Auth 的 credential / Google / GitHub）用固定文案，
 * 通用 OIDC 用管理员在 `auth_provider.display_name` 里配置的名称。
 * 用户设置页与管理员用户列表共用这一份，避免两边叫法不一致。
 */
export type LoginAccountKind = 'email' | 'google' | 'github' | 'oidc'

const BUILTIN_LABELS: Record<string, string> = {
  credential: '邮箱密码',
  google: 'Google',
  github: 'GitHub',
}

export function accountLabel(
  providerId: string,
  displayName?: string | null,
): string {
  if (providerId === 'credential') return BUILTIN_LABELS.credential
  return displayName?.trim() || BUILTIN_LABELS[providerId] || providerId
}

export function accountKind(
  providerId: string,
  providerKind?: string | null,
): LoginAccountKind {
  if (providerId === 'credential') return 'email'
  if (providerKind === 'google' || providerKind === 'github') {
    return providerKind
  }
  if (providerId === 'google' || providerId === 'github') return providerId
  return 'oidc'
}
