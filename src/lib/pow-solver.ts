/**
 * 工作量证明求解（纯函数，在浏览器里运行）。协议见 src/server/auth/pow.ts。
 */

export const POW_HEADER = 'x-pow-solution'

export interface PowChallengeInput {
  algorithm: 'SHA-256'
  challenge: string
  salt: string
  maxnumber: number
  signature: string
}

const encoder = new TextEncoder()

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

async function sha256Hex(value: string): Promise<string> {
  // 类型上 subtle 恒存在，只在安全上下文（https / localhost）才真正可用
  const subtle = globalThis.crypto.subtle as SubtleCrypto | undefined
  if (!subtle) {
    // crypto.subtle 只在安全上下文（https / localhost）可用
    throw new Error('当前页面不是 HTTPS，无法完成人机校验')
  }
  return toHex(await subtle.digest('SHA-256', encoder.encode(value)))
}

/** 并发批量计算：逐个 await 时 Promise 调度开销比哈希本身还大 */
const BATCH_SIZE = 256

/** 枚举 0..maxnumber，返回提交用的 base64 请求头；找不到解时返回 null */
export async function solvePowChallenge(
  input: PowChallengeInput,
): Promise<string | null> {
  for (let start = 0; start <= input.maxnumber; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, input.maxnumber)
    const numbers: number[] = []
    for (let n = start; n <= end; n += 1) numbers.push(n)

    const hashes = await Promise.all(
      numbers.map((n) => sha256Hex(`${input.salt}${n}`)),
    )
    const index = hashes.indexOf(input.challenge)
    if (index === -1) continue

    return btoa(
      JSON.stringify({
        algorithm: input.algorithm,
        challenge: input.challenge,
        salt: input.salt,
        number: numbers[index],
        signature: input.signature,
      }),
    )
  }
  return null
}
