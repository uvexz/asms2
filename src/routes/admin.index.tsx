import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Spinner } from '#/components/base/spinner/spinner'
import { ErrorState } from '#/components/application/errors/error-state'
import { StatTile } from '#/components/admin/ui'
import { adminOverviewFn } from '#/server/fns/admin'
import { unwrap } from '#/lib/api'

export const Route = createFileRoute('/admin/')({
  head: () => ({ meta: [{ title: '概览 · 管理后台' }] }),
  component: AdminOverview,
})

function AdminOverview() {
  const query = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: async () => unwrap(await adminOverviewFn()),
  })

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        title="概览加载失败"
        onRetry={() => void query.refetch()}
      />
    )
  }

  const data = query.data

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-title-2-medium text-text-primary">概览</h2>
        <p className="mt-1 text-body-regular text-text-secondary">
          站点运行状态与关键计数
        </p>
      </div>

      <div className="grid auto-rows-fr grid-cols-2 gap-3 xl:grid-cols-5">
        <StatTile label="用户" value={data?.users ?? 0} />
        <StatTile label="邮箱" value={data?.mailboxes ?? 0} hint="不含已删除" />
        <StatTile label="邮件总数" value={data?.messages ?? 0} />
        <StatTile label="已发送" value={data?.outbound ?? 0} />
        <StatTile
          className="col-span-2 xl:col-span-1"
          label="失败 Webhook"
          value={data?.failedWebhooks ?? 0}
          hint="需关注"
        />
      </div>

      <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-4 sm:p-5">
        <h3 className="text-headline-medium text-text-primary">下一步</h3>
        <ol className="mt-3 flex flex-col gap-2 text-body-regular text-text-secondary">
          <li>
            1. 在「服务商」里添加 Resend / UnitPost / AhaSend 的 API Key。
          </li>
          <li>
            2. 在「域名」里接入域名，按服务商返回的 MX / SPF / DKIM
            记录配置后验证。
          </li>
          <li>
            3. 在「服务商」里创建 Webhook 端点，把生成的 URL 填到服务商控制台。
          </li>
          <li>4. 在「站点信息」里确认注册开关、配额与临时邮箱有效期。</li>
        </ol>
      </div>
    </div>
  )
}
