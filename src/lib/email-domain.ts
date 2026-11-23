/**
 * 邮箱域名（注册白名单）的归一、校验与匹配，以及白名单模式下的
 * 「前缀 + 后缀」拼装。
 *
 * 纯函数，不依赖 db / 请求上下文：管理面板、公开登录配置、注册页与
 * better-auth 注册钩子共用同一份规则，避免「面板能存、注册判不出来」
 * 这类口径漂移。
 *
 * 匹配语义是**精确域名**：白名单里的 `example.com` 只放行 `x@example.com`，
 * 不放行 `x@mail.example.com`。子域名由控制不同主体，自动继承会让白名单
 * 在无感知的情况下扩大授权范围，因此要求管理员显式添加。
 */

/** 单个域名的最大长度（DNS 名称上限） */
const MAX_DOMAIN_LENGTH = 253
/** 单个 label 的最大长度 */
const MAX_LABEL_LENGTH = 63
/** 白名单条目上限：够用且能防止配置被写成巨型 JSON */
export const MAX_REGISTRATION_DOMAINS = 200
/** 提示文案里最多罗列的域名个数 */
const MESSAGE_DOMAIN_PREVIEW = 5

/** 至少两段、允许 xn-- 编码的中文域名，不接受通配符与下划线 */
const DOMAIN_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

function isWellFormedDomain(value: string): boolean {
  if (value.length === 0 || value.length > MAX_DOMAIN_LENGTH) return false
  if (!DOMAIN_PATTERN.test(value)) return false
  return value
    .split('.')
    .every((label) => label.length > 0 && label.length <= MAX_LABEL_LENGTH)
}

/**
 * 把管理员输入归一为可直接比较的域名：
 *   `  @Example.COM ` → `example.com`
 *   `Foo@Bar.Example.com.` → `bar.example.com`
 * 无法解析时返回 null（调用方负责给出「格式不正确」提示）。
 */
export function normalizeEmailDomain(raw: string): string | null {
  let value = raw.trim().toLowerCase()
  if (!value) return null

  // 允许直接粘贴完整邮箱，取最后一个 @ 之后的部分
  const at = value.lastIndexOf('@')
  if (at >= 0) value = value.slice(at + 1)
  // 去掉首尾多余的点（FQDN 写法 example.com.）
  value = value.replace(/^\.+/, '').replace(/\.+$/, '')
  if (!value) return null

  return isWellFormedDomain(value) ? value : null
}

/** 从完整邮箱地址取出归一后的域名；地址不合法时返回 null */
export function emailDomainOf(address: string): string | null {
  const value = address.trim().toLowerCase()
  const at = value.lastIndexOf('@')
  if (at <= 0 || at === value.length - 1) return null
  const domain = value.slice(at + 1).replace(/\.+$/, '')
  return isWellFormedDomain(domain) ? domain : null
}

export interface ParsedDomainList {
  /** 归一、去重后的域名，保持输入顺序 */
  domains: string[]
  /** 原始输入里格式不正确的条目（已 trim），用于错误提示 */
  invalid: string[]
}

/**
 * 归一一批管理员输入。空条目直接忽略（粘贴多行时的空行），
 * 重复条目只保留第一次出现，格式错误的原样放进 `invalid`。
 */
export function parseEmailDomainList(
  values: readonly string[],
): ParsedDomainList {
  const domains: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()

  for (const raw of values) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const domain = normalizeEmailDomain(trimmed)
    if (!domain) {
      invalid.push(trimmed)
      continue
    }
    if (seen.has(domain)) continue
    seen.add(domain)
    domains.push(domain)
    if (domains.length >= MAX_REGISTRATION_DOMAINS) break
  }

  return { domains, invalid }
}

/** 读取数据库里存的 JSON；损坏或历史脏数据一律当作空列表 */
export function parseStoredEmailDomains(
  json: string | null | undefined,
): string[] {
  if (!json) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parseEmailDomainList(
    parsed.filter((item): item is string => typeof item === 'string'),
  ).domains
}

/** 写入数据库前序列化；空列表存 null，保持列上「未配置」的含义 */
export function serializeEmailDomains(
  domains: readonly string[],
): string | null {
  return domains.length > 0 ? JSON.stringify(domains) : null
}

/** 注册邮箱是否命中白名单（精确域名匹配，忽略大小写与首尾空格） */
export function isEmailDomainAllowed(
  address: string,
  domains: readonly string[],
): boolean {
  const domain = emailDomainOf(address)
  if (!domain) return false
  return domains.includes(domain)
}

/* ---------------------------------------------------- 白名单模式下的前缀 */

/** 邮箱前缀上限（RFC 5321 的 local-part 长度） */
export const MAX_EMAIL_PREFIX_LENGTH = 64

/** 首尾必须是字母或数字，中间允许 . _ % + -，不允许连续点 */
const EMAIL_PREFIX_PATTERN = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?$/

/**
 * 归一注册页输入的邮箱前缀，不合法时返回 null。
 *
 * 前缀就是邮箱 @ 之前的部分：`Alice.W` → `alice.w`。
 * 采集这里而不是整个地址，是因为白名单模式下的后缀只能从管理员给定的
 * 列表里选，用户输入的任何后缀都不该被拼进请求。
 */
export function normalizeEmailPrefix(raw: string): string | null {
  const value = raw.trim().toLowerCase()
  if (!value || value.length > MAX_EMAIL_PREFIX_LENGTH) return null
  if (value.includes('..')) return null
  return EMAIL_PREFIX_PATTERN.test(value) ? value : null
}

/** 前缀 + 白名单后缀拼成完整地址；任一侧不合法返回 null */
export function composeEmailAddress(
  prefix: string,
  domain: string,
): string | null {
  const localPart = normalizeEmailPrefix(prefix)
  const suffix = normalizeEmailDomain(domain)
  if (!localPart || !suffix) return null
  return `${localPart}@${suffix}`
}

/** 前缀不合法时给用户的提示；合法返回 null */
export function emailPrefixError(raw: string): string | null {
  if (!raw.trim()) return '请输入邮箱前缀'
  return normalizeEmailPrefix(raw)
    ? null
    : `邮箱前缀只能包含字母、数字和 . _ % + -，且不能以符号开头或结尾（最长 ${MAX_EMAIL_PREFIX_LENGTH} 位）`
}

/** `@a.com、@b.com` 形式的展示文案，超量时折叠 */
export function formatEmailDomains(domains: readonly string[]): string {
  const shown = domains
    .slice(0, MESSAGE_DOMAIN_PREVIEW)
    .map((item) => `@${item}`)
  const rest = domains.length - shown.length
  return rest > 0
    ? `${shown.join('、')} 等 ${domains.length} 个域名`
    : shown.join('、')
}

/**
 * 注册被拒时对外统一的文案。页面预校验与服务端钩子共用，
 * 保证「点提交前」和「服务端返回」说的是同一句话。
 */
export function emailDomainWhitelistMessage(
  domains: readonly string[],
): string {
  if (domains.length === 0) {
    return '管理员已启用注册域名白名单，但尚未配置允许的域名，暂时无法注册，请联系管理员'
  }
  return `该邮箱域名不在允许注册的范围内，仅支持 ${formatEmailDomains(domains)} 的邮箱`
}
