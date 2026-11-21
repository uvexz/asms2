import { QueryClient } from '@tanstack/react-query'

import { isNonRetryableError } from '#/lib/query-error'

export function getContext() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // 集中配置，避免每个查询各写一份、管理页还停在 staleTime 0
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        // 401/404/校验失败重试没有意义。网络/5xx 只重试一次：failureCount 从 0
        // 起算，`< 1` 表示放行一次重试（共两次请求），别让人对着 spinner 等 3 秒
        retry: (failureCount, error) =>
          !isNonRetryableError(error) && failureCount < 1,
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
