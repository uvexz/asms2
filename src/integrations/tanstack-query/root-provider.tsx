import { QueryClient } from '@tanstack/react-query'

import { isNonRetryableError } from '#/lib/query-error'

export function getContext() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // 集中配置，避免每个查询各写一份、管理页还停在 staleTime 0
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        // 401/404/校验失败重试没有意义，网络和服务端错误最多再来一次
        retry: (failureCount, error) =>
          !isNonRetryableError(error) && failureCount < 2,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  })

  return {
    queryClient,
  }
}
export default function TanstackQueryProvider() {}
