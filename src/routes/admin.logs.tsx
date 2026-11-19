import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/base/buttons/button'
import { Chip } from '#/components/base/badges/chip'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '#/components/base/segmented-control/segmented-control'
import { Spinner } from '#/components/base/spinner/spinner'
import { ErrorState } from '#/components/application/errors/error-state'
import { EmptyHint, PageSection } from '#/components/admin/ui'
import {
  adminListAuditFn,
  adminListUnroutedFn,
  adminListWebhookEventsFn,
} from '#/server/fns/admin'
import { formatDateTime, unwrap } from '#/lib/api'

export const Route = createFileRoute('/admin/logs')({
  head: () => ({ meta: [{ title: '日志 · 管理后台' }] }),
  component: AdminLogs,
})

const PAGE_SIZE = 100

type Tab = 'audit' | 'webhook' | 'unrouted'

function AdminLogs() {
  const [tab, setTab] = useState<Tab>('audit')
  const [offset, setOffset] = useState(0)

  const audit = useQuery({
    queryKey: ['admin', 'audit', offset],
    queryFn: async () =>
      unwrap(await adminListAuditFn({ data: { limit: PAGE_SIZE, offset } })),
    enabled: tab === 'audit',
  })
  const events = useQuery({
    queryKey: ['admin', 'webhook-events', offset],
    queryFn: async () =>
      unwrap(
        await adminListWebhookEventsFn({ data: { limit: PAGE_SIZE, offset } }),
      ),
    enabled: tab === 'webhook',
  })
  const unrouted = useQuery({
    queryKey: ['admin', 'unrouted', offset],
    queryFn: async () =>
      unwrap(await adminListUnroutedFn({ data: { limit: 50, offset } })),
    enabled: tab === 'unrouted',
  })

  const active = tab === 'audit' ? audit : tab === 'webhook' ? events : unrouted
  const rows = active.data?.rows ?? []

  return (
    <div className="flex flex-col gap-5">
      <PageSection
        title="日志"
        description="审计操作、Webhook 事件，以及无法投递的收件墓碑"
        actions={
          <SegmentedControl
            selectedKeys={[tab]}
            onSelectionChange={(keys) => {
              const next = Array.from(keys)[0]
              if (
                next === 'audit' ||
                next === 'webhook' ||
                next === 'unrouted'
              ) {
                setTab(next)
                setOffset(0)
              }
            }}
            aria-label="日志类型"
          >
            <SegmentedControlItem id="audit">审计</SegmentedControlItem>
            <SegmentedControlItem id="webhook">Webhook</SegmentedControlItem>
            <SegmentedControlItem id="unrouted">未投递</SegmentedControlItem>
          </SegmentedControl>
        }
      >
        {active.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="size-5" />
          </div>
        ) : null}

        {active.isError ? (
          <ErrorState
            error={active.error}
            title="日志加载失败"
            onRetry={() => void active.refetch()}
          />
        ) : null}

        {!active.isLoading && !active.isError && rows.length === 0 ? (
          <EmptyHint>
            {tab === 'audit'
              ? '还没有管理操作'
              : tab === 'webhook'
                ? '还没有收到 Webhook'
                : '没有未投递的收件'}
          </EmptyHint>
        ) : null}

        {!active.isError && rows.length > 0 ? (
          <>
            <div className="flex flex-col divide-y divide-separator-border">
              {tab === 'audit'
                ? audit.data?.rows.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-body-regular text-text-primary">
                          {row.action}
                          {row.targetId ? (
                            <span className="text-text-tertiary">
                              {' '}
                              · {row.targetId}
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-caption-1-regular text-text-tertiary">
                          {row.actorEmail ?? '系统'} ·{' '}
                          {formatDateTime(row.createdAt)}
                        </p>
                      </div>
                      <Chip className="shrink-0" color="gray">
                        {row.targetType ?? 'system'}
                      </Chip>
                    </div>
                  ))
                : null}

              {tab === 'webhook'
                ? events.data?.rows.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-body-regular text-text-primary">
                          {row.type}
                        </p>
                        <p className="truncate text-caption-1-regular text-text-tertiary">
                          {formatDateTime(row.receivedAt)}
                          {row.error ? ` · ${row.error}` : ''}
                        </p>
                      </div>
                      <Chip
                        className="shrink-0"
                        color={
                          row.status === 'processed'
                            ? 'lime'
                            : row.status === 'failed'
                              ? 'rose'
                              : 'gray'
                        }
                      >
                        {row.status}
                      </Chip>
                    </div>
                  ))
                : null}

              {tab === 'unrouted'
                ? unrouted.data?.rows.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-body-regular text-text-primary">
                          {row.subject || '(无主题)'}
                        </p>
                        <p className="truncate text-caption-1-regular text-text-tertiary">
                          {row.from} · {formatDateTime(row.createdAt)}
                        </p>
                      </div>
                      <Chip className="shrink-0" color="yellow">
                        {row.reason}
                      </Chip>
                    </div>
                  ))
                : null}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-caption-1-regular text-text-tertiary">
                第 {offset + 1}–{offset + rows.length} 条
              </span>
              <div className="flex gap-2">
                <Button
                  size="small"
                  variant="secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  上一页
                </Button>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={!active.data?.hasMore}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </PageSection>
    </div>
  )
}
