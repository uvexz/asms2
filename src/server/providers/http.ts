import { ProviderError } from './types'

interface ProviderErrorShape {
  message: string
  code?: string
}

/**
 * 适配器统一走这里：超时、非 2xx、网络错误都转成 ProviderError，
 * retryable 决定发件能否重试、Webhook 是否返回 5xx。
 */
export async function requestJson<T>(params: {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
  label: string
  timeoutMs?: number
  parseError?: (status: number, payload: unknown) => ProviderErrorShape
}): Promise<T> {
  const hasBody = params.body !== undefined

  let response: Response
  try {
    response = await fetch(params.url, {
      method: params.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...params.headers,
      },
      body: hasBody ? JSON.stringify(params.body) : undefined,
      signal: AbortSignal.timeout(params.timeoutMs ?? 15_000),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : '未知错误'
    throw new ProviderError(`${params.label} 请求失败：${reason}`, {
      code: 'network_error',
      retryable: true,
    })
  }

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    const parsed = params.parseError?.(response.status, payload)
    throw new ProviderError(
      parsed?.message ?? `${params.label} 返回 HTTP ${response.status}`,
      {
        code: parsed?.code ?? `http_${response.status}`,
        httpStatus: response.status,
        retryable: response.status === 429 || response.status >= 500,
      },
    )
  }

  return payload as T
}

export function trimBaseUrl(
  value: string | null | undefined,
  fallback: string,
) {
  return (value?.trim() || fallback).replace(/\/+$/, '')
}
