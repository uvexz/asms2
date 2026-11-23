import type { QueryClient } from '@tanstack/react-query'
import type { AnyRouter, UseNavigateResult } from '@tanstack/react-router'

import { toast } from '#/components/base/toast/toast'
import { clearUserCaches } from '#/lib/api'
import { authClient } from '#/lib/auth-client'

export async function performSignOut({
  queryClient,
  router,
  navigate,
}: {
  queryClient: QueryClient
  router: Pick<AnyRouter, 'invalidate'>
  navigate: UseNavigateResult<string>
}): Promise<boolean> {
  let result: Awaited<ReturnType<typeof authClient.signOut>>
  try {
    result = await authClient.signOut()
  } catch {
    // 网络拒绝时没有可靠的退出结果，保留缓存和当前页面，不能假装已经退出。
    toast.error('退出登录失败，请检查网络后重试')
    return false
  }

  if (result.error) {
    toast.error(result.error.message ?? '退出登录失败，请稍后重试')
    return false
  }

  // 只有服务端确认退出后才能丢弃用户数据；公开登录配置与此账号无关，继续保留。
  clearUserCaches(queryClient)
  // 当前路由守卫的重定向不属于退出失败；导航本身仍由调用方完成。
  await router.invalidate().catch(() => undefined)
  await navigate({ to: '/login' })
  return true
}
