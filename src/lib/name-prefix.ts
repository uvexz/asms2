/**
 * 临时邮箱随机前缀：常见姓氏 + 名字（拼音，无音调）拼接生日后缀。
 * 格式为 [姓][名][日期]，形如 liuxiang1998 / zhangboheng1025 / baixiaocun199805，
 * 只包含小写字母与数字，满足地址前缀 [a-z0-9]+ 的约束。
 * 生日按 18–40 岁动态取，Web 弹窗与 Telegram Bot 共用。
 *
 * 该模块同时用于浏览器、SSR 与 Telegram，只依赖 Web Crypto，
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

const SURNAMES = [
  // 单字姓
  'ai',
  'an',
  'ao',
  'bai',
  'bao',
  'bei',
  'bi',
  'bian',
  'bu',
  'cai',
  'cao',
  'cen',
  'chai',
  'chang',
  'chen',
  'cheng',
  'chi',
  'chu',
  'cui',
  'dai',
  'deng',
  'di',
  'ding',
  'dong',
  'dou',
  'du',
  'duan',
  'fan',
  'fang',
  'fei',
  'feng',
  'fu',
  'gan',
  'gao',
  'ge',
  'geng',
  'gong',
  'gu',
  'guan',
  'guo',
  'han',
  'hao',
  'he',
  'hong',
  'hou',
  'hu',
  'hua',
  'huang',
  'huo',
  'ji',
  'jia',
  'jiang',
  'jiao',
  'jin',
  'jing',
  'ju',
  'kan',
  'kang',
  'ke',
  'kong',
  'kuang',
  'lei',
  'li',
  'lian',
  'liang',
  'liao',
  'lin',
  'ling',
  'liu',
  'long',
  'lou',
  'lu',
  'lv',
  'luo',
  'ma',
  'mao',
  'mei',
  'meng',
  'mi',
  'miao',
  'min',
  'ming',
  'mo',
  'mu',
  'ni',
  'nie',
  'ning',
  'niu',
  'ou',
  'pan',
  'pang',
  'pei',
  'peng',
  'pi',
  'qi',
  'qian',
  'qiao',
  'qin',
  'qiu',
  'qu',
  'quan',
  'ren',
  'rong',
  'ruan',
  'shan',
  'shao',
  'shen',
  'sheng',
  'shi',
  'shu',
  'song',
  'su',
  'sun',
  'tan',
  'tang',
  'tao',
  'tian',
  'tong',
  'wan',
  'wang',
  'wei',
  'wen',
  'wu',
  'xi',
  'xia',
  'xian',
  'xiang',
  'xiao',
  'xie',
  'xin',
  'xing',
  'xiong',
  'xu',
  'xue',
  'yan',
  'yang',
  'yao',
  'ye',
  'yi',
  'yin',
  'ying',
  'you',
  'yu',
  'yuan',
  'yue',
  'yun',
  'zang',
  'zeng',
  'zha',
  'zhai',
  'zhan',
  'zhang',
  'zhao',
  'zhen',
  'zheng',
  'zhi',
  'zhong',
  'zhou',
  'zhu',
  'zhuang',
  'zhuo',
  'zou',
  'zu',
  // 复姓
  'ouyang',
  'shangguan',
  'situ',
  'sima',
  'zhuge',
  'dongfang',
  'huangfu',
  'yuchi',
  'gongyang',
  'xiahou',
  'murong',
  'yuwen',
  'changsun',
  'duanmu',
  'ximen',
  'nangong',
  'linghu',
  'zhongli',
  'xuanyuan',
  'dugu',
] as const

const GIVEN_NAMES = [
  'hao',
  'haoran',
  'haoyu',
  'haoxuan',
  'haotian',
  'haoming',
  'yuxuan',
  'yutong',
  'yuxin',
  'yuhang',
  'yuchen',
  'yifan',
  'yinuo',
  'yiran',
  'yize',
  'yifeng',
  'yihang',
  'yijun',
  'yiming',
  'yiyang',
  'yong',
  'yongqiang',
  'yongjie',
  'yongkang',
  'yonghui',
  'yue',
  'yunfei',
  'yunlong',
  'yunxi',
  'ze',
  'zeyu',
  'zeyang',
  'zesheng',
  'zhiwei',
  'zhiyuan',
  'zhiqiang',
  'zhiming',
  'zhihao',
  'zhiyu',
  'zhiyong',
  'zhixin',
  'zijun',
  'zihan',
  'zimo',
  'zixuan',
  'ziqing',
  'ziyi',
  'zining',
  'zirui',
  'ziyang',
  'jing',
  'jingyi',
  'jingwen',
  'jingyu',
  'jinghao',
  'jingxuan',
  'jiaxin',
  'jiahao',
  'jiahui',
  'jiajun',
  'jiayi',
  'jian',
  'jianfeng',
  'jianguo',
  'jianjun',
  'jianming',
  'jianping',
  'jun',
  'junjie',
  'junhao',
  'junyi',
  'junfeng',
  'ming',
  'mingze',
  'mingyu',
  'minghao',
  'mingjie',
  'mingxuan',
  'xiang',
  'xiaoming',
  'xiaocun',
  'xiaoyu',
  'xiaofeng',
  'xiaolong',
  'xiaowei',
  'xiaohui',
  'xiangyu',
  'xin',
  'xinyi',
  'xinyu',
  'xinran',
  'xinyan',
  'xuan',
  'xuefeng',
  'xueying',
  'xue',
  'fei',
  'fang',
  'fangmin',
  'feng',
  'fengyu',
  'fenghua',
  'bin',
  'bing',
  'bo',
  'boheng',
  'chen',
  'chenxi',
  'cheng',
  'chenglin',
  'chao',
  'chun',
  'chunyu',
  'dan',
  'dong',
  'dongyu',
  'enze',
  'gang',
  'guang',
  'guohua',
  'guoqiang',
  'han',
  'hanwen',
  'hanyu',
  'hong',
  'hongyu',
  'hongwei',
  'hongtao',
  'hui',
  'huimin',
  'huiying',
  'jia',
  'ke',
  'kun',
  'lei',
  'li',
  'lin',
  'ling',
  'lu',
  'mei',
  'min',
  'na',
  'nan',
  'ning',
  'peng',
  'pengfei',
  'qi',
  'qian',
  'qiang',
  'qing',
  'qingyu',
  'ran',
  'rui',
  'ruoxi',
  'ruiqi',
  'rong',
  'shan',
  'shanshan',
  'shuai',
  'shuting',
  'siyuan',
  'siqi',
  'song',
  'shuang',
  'tao',
  'teng',
  'ting',
  'wan',
  'wanqing',
  'wei',
  'weimin',
  'weiwei',
  'weijie',
  'wen',
  'wenbo',
  'wenjie',
  'wenjing',
  'wenxuan',
  'xi',
  'xiao',
  'xiaoxiao',
  'xiu',
  'xu',
  'ya',
  'yan',
  'yanan',
  'yang',
  'ye',
  'yi',
  'ying',
  'you',
  'yu',
  'yuan',
  'zhen',
  'zhenyu',
  'zheng',
  'zhuo',
  'zhi',
  'lihua',
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

/** [姓，汉语拼音][名，汉语拼音][随机日期] */
function personalCandidate(): string {
  return pickRandom(SURNAMES) + pickRandom(GIVEN_NAMES) + randomBirthdaySuffix()
}

export interface RandomNamePrefixOptions {
  minLength?: number
  maxLength?: number
  /** 默认 personal（姓+名+日期）；opaque 仅用于纯随机无意义字符序列。 */
  style?: 'personal' | 'opaque'
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

  if (options.style === 'opaque') {
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
