import { useCallback, useEffect, useRef, useState } from 'react'

import { getPowChallengeFn } from '#/server/fns/site'

import { POW_HEADER, solvePowChallenge } from './pow-solver'

/**
 * 认证页用的人机校验 hook：页面挂载时就在后台取题并求解，
 * 用户点提交时通常已经算完，不增加等待。
 */

/** 题目 10 分钟过期，留 2 分钟余量 */
const SOLUTION_MAX_AGE_MS = 8 * 60 * 1000

/**
 * - idle：还没开始（prefetch=false 时的初始状态）
 * - solving：正在取题 / 计算
 * - ready：已备好一份解答
 * - error：取题或计算失败（可调用 retry）
 * - disabled：站点关闭了人机校验
 */
export type PowStatus = 'idle' | 'solving' | 'ready' | 'error' | 'disabled'

type Outcome = { header: string } | { disabled: true }

async function fetchAndSolve(): Promise<Outcome> {
  const challenge = await getPowChallengeFn()
  if (!challenge) return { disabled: true }
  const header = await solvePowChallenge(challenge)
  if (!header) throw new Error('人机校验题目无解')
  return { header }
}

function statusOf(outcome: Outcome): PowStatus {
  return 'disabled' in outcome ? 'disabled' : 'ready'
}

/**
 * 每份解答只能用一次，取走后立刻在后台准备下一份，连续重试也不用等。
 * prefetch=false 时不在挂载时预算，只在真正提交时现算（用于很少触发的按钮）。
 *
 * 用法：
 *   const pow = usePowHeaders()
 *   await authClient.signIn.email({ ..., fetchOptions: { headers: await pow.getHeaders() } })
 *   <PowStatusLine status={pow.status} onRetry={pow.retry} />
 */
export function usePowHeaders(prefetch = true) {
  const [status, setStatus] = useState<PowStatus>(prefetch ? 'solving' : 'idle')
  const pending = useRef<{ promise: Promise<Outcome>; at: number } | null>(null)
  const generation = useRef(0)

  const prepare = useCallback(() => {
    const current = ++generation.current
    const promise = fetchAndSolve()
    pending.current = { promise, at: Date.now() }
    setStatus('solving')
    promise.then(
      (outcome) => {
        if (generation.current === current) setStatus(statusOf(outcome))
      },
      (error: unknown) => {
        console.error('[pow] 人机校验准备失败:', error)
        if (generation.current === current) setStatus('error')
      },
    )
  }, [])

  useEffect(() => {
    if (prefetch) prepare()
  }, [prefetch, prepare])

  const getHeaders = useCallback(async (): Promise<Record<string, string>> => {
    let current = pending.current
    if (!current || Date.now() - current.at > SOLUTION_MAX_AGE_MS) {
      prepare()
      current = pending.current
    }
    pending.current = null

    let outcome: Outcome | null = null
    try {
      outcome = (await current?.promise) ?? null
    } catch {
      // 预取失败（网络抖动）时再试一次；仍失败就不带头提交，由服务端给出明确报错
      outcome = await fetchAndSolve().catch(() => null)
    }

    if (prefetch) prepare()
    else if (outcome) setStatus(statusOf(outcome))
    else setStatus('error')

    return outcome && 'header' in outcome
      ? { [POW_HEADER]: outcome.header }
      : {}
  }, [prefetch, prepare])

  return { getHeaders, status, retry: prepare }
}
