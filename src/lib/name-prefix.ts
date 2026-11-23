/**
 * 随机邮箱前缀。默认使用不透明的密码学随机标识；只有显式选择
 * `style: 'personal'` 时才生成旧的「姓名 + 生日」风格。
 *
 * 该模块同时用于浏览器、SSR 与 Telegram，因此只依赖 Web Crypto，
 * 不引入 node:crypto，也不依赖服务端代码。
 */

const MIN_AGE = 18
const MAX_AGE = 40
const DEFAULT_MIN_LENGTH = 8
const DEFAULT_MAX_LENGTH = 32
const MAX_PREFIX_LENGTH = 64
const MAX_ATTEMPTS = 32
const OPAQUE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'
const UINT32_RANGE = 0x1_0000_0000

// personal 是显式 opt-in 的兼容风格，不再作为隐私地址的默认格式。
const PERSONAL_SURNAMES = [
  'zhang',
  'wang',
  'li',
  'zhao',
  'chen',
  'liu',
  'yang',
  'huang',
  'zhou',
  'wu',
  'xu',
  'sun',
] as const

const PERSONAL_GIVEN_NAMES = [
  'wei',
  'fang',
  'ming',
  'xin',
  'yu',
  'hao',
  'jun',
  'jing',
  'yang',
  'bo',
  'lei',
  'ran',
] as const

/** 无模偏差的均匀抽样；拒绝超出完整整数区间的尾部值。 */
function randomIndex(exclusiveMax: number): number {
  const limit = UINT32_RANGE - (UINT32_RANGE % exclusiveMax)
  const buffer = new Uint32Array(1)
  let value: number
  do {
    crypto.getRandomValues(buffer)
    value = buffer[0]
  } while (value >= limit)
  return value % exclusiveMax
}

function pickRandom<T>(list: readonly T[]): T {
  return list[randomIndex(list.length)]
}

function randomInt(min: number, max: number): number {
  return min + randomIndex(max - min + 1)
}

function opaqueCandidate(length: number): string {
  let candidate = ''
  while (candidate.length < length) {
    candidate += OPAQUE_CHARS[randomIndex(OPAQUE_CHARS.length)]
  }
  return candidate
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 在 18–40 岁的合法出生日期窗口内均匀取一天。 */
function randomBirthDate(): Date {
  const now = new Date()
  const earliest = new Date(
    now.getFullYear() - MAX_AGE,
    now.getMonth(),
    now.getDate(),
  )
  const latest = new Date(
    now.getFullYear() - MIN_AGE,
    now.getMonth(),
    now.getDate(),
  )
  const days = Math.floor((latest.getTime() - earliest.getTime()) / 86_400_000)
  return new Date(earliest.getTime() + randomInt(0, days) * 86_400_000)
}

/** 生日后缀：年份（1998）/ 月日（1025）/ 年月（199805）。 */
function randomBirthdaySuffix(): string {
  const birth = randomBirthDate()
  const month = pad2(birth.getMonth() + 1)
  const day = pad2(birth.getDate())
  switch (randomInt(0, 2)) {
    case 0:
      return String(birth.getFullYear())
    case 1:
      return `${month}${day}`
    default:
      return `${birth.getFullYear()}${month}`
  }
}

function personalCandidate(): string {
  return (
    pickRandom(PERSONAL_SURNAMES) +
    pickRandom(PERSONAL_GIVEN_NAMES) +
    randomBirthdaySuffix()
  )
}

export interface RandomNamePrefixOptions {
  minLength?: number
  maxLength?: number
  /** 默认 opaque；personal 仅用于显式请求旧式随机名的场景。 */
  style?: 'opaque' | 'personal'
}

export function randomNameLocalPart(
  options: RandomNamePrefixOptions = {},
): string {
  const min = options.minLength ?? DEFAULT_MIN_LENGTH
  const max = options.maxLength ?? DEFAULT_MAX_LENGTH

  if (!Number.isInteger(min) || min < 1 || min > MAX_PREFIX_LENGTH) {
    throw new RangeError(`minLength 必须是 1–${MAX_PREFIX_LENGTH} 的整数`)
  }
  if (!Number.isInteger(max) || max < 1 || max > MAX_PREFIX_LENGTH) {
    throw new RangeError(`maxLength 必须是 1–${MAX_PREFIX_LENGTH} 的整数`)
  }
  if (max < DEFAULT_MIN_LENGTH) {
    throw new RangeError(`随机前缀至少需要 ${DEFAULT_MIN_LENGTH} 位`)
  }

  // 即使调用方配置了更短的 min，也不能生成低于 8 位的随机地址。
  const effectiveMin = Math.max(min, DEFAULT_MIN_LENGTH)
  if (effectiveMin > max) {
    throw new RangeError('minLength 不能大于 maxLength')
  }

  if ((options.style ?? 'opaque') === 'opaque') {
    return opaqueCandidate(randomInt(effectiveMin, max))
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = personalCandidate()
    if (candidate.length >= effectiveMin && candidate.length <= max) {
      return candidate
    }
  }

  // 姓名组合无法满足长度窗口时仍保证返回合法长度；所有字符同样来自 CSPRNG。
  let candidate = personalCandidate()
  while (candidate.length < effectiveMin) {
    candidate += OPAQUE_CHARS[randomIndex(OPAQUE_CHARS.length)]
  }
  return candidate.slice(0, max)
}
