import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Chip } from '@/components/base/badges/chip'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@/components/base/segmented-control/segmented-control'
import { Spinner } from '@/components/base/spinner/spinner'
import { EmptyHint, PageSection } from '@/components/admin/ui'
import {
  adminListAuditFn,
  adminListUnroutedFn,
  adminListWebhookEventsFn,
} from '#/server/fns/admin'
import { formatDateTime, unwrap } from '#/lib/api'

export const Route = createFileRoute('/admin/logs')({
  component: AdminLogs,
})

function AdminLogs() {
  const [tab, setTab] = useState<'audit' | 'webhook' | 'unrouted'>('audit')

  const audit = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: async () => unwrap(await adminListAuditFn()),
    enabled: tab === 'audit',
  })
  const events = useQuery({
    queryKey: ['admin', 'webhook-events'],
    queryFn: async () => unwrap(await adminListWebhookEventsFn()),
    enabled: tab === 'webhook',
  })
  const unrouted = useQuery({
    queryKey: ['admin', 'unrouted'],
    queryFn: async () => unwrap(await adminListUnroutedFn()),
    enabled: tab === 'unrouted',
  })

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
        {tab === 'audit' ? (
          audit.isLoading ? (
            <Spinner className="size-5" />
          ) : (audit.data ?? []).length === 0 ? (
            <EmptyHint>还没有管理操作</EmptyHint>
          ) : (
            <div className="flex flex-col divide-y divide-separator-border">
              {(audit.data ?? []).map((row) => (
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
              ))}
            </div>
          )
        ) : null}

        {tab === 'webhook' ? (
          events.isLoading ? (
            <Spinner className="size-5" />
          ) : (events.data ?? []).length === 0 ? (
            <EmptyHint>还没有收到 Webhook</EmptyHint>
          ) : (
            <div className="flex flex-col divide-y divide-separator-border">
              {(events.data ?? []).map((row) => (
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
              ))}
            </div>
          )
        ) : null}

        {tab === 'unrouted' ? (
          unrouted.isLoading ? (
            <Spinner className="size-5" />
          ) : (unrouted.data ?? []).length === 0 ? (
            <EmptyHint>没有未投递的收件</EmptyHint>
          ) : (
            <div className="flex flex-col divide-y divide-separator-border">
              {(unrouted.data ?? []).map((row) => (
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
              ))}
            </div>
          )
        ) : null}
      </PageSection>
    </div>
  )
}
