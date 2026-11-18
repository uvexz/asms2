import type { ReactNode } from 'react'

import { cx } from '@/utils/cx'

export function PageSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cx(
        'rounded-3xl border border-border-button-default bg-background-primary-default p-5',
        className,
      )}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-headline-medium text-text-primary">{title}</h2>
          {description ? (
            <p className="mt-1 text-caption-1-regular text-text-tertiary">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: ReactNode
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-border-button-default bg-background-secondary-default p-4">
      <p className="text-caption-1-regular text-text-tertiary">{label}</p>
      <p className="mt-1 text-title-2-medium tabular-nums text-text-primary">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-caption-1-regular text-text-tertiary">{hint}</p>
      ) : null}
    </div>
  )
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border-button-default p-4 text-center text-caption-1-regular text-text-tertiary">
      {children}
    </p>
  )
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-caption-1-regular text-text-tertiary">{label}</span>
      <span className="text-caption-1-medium text-text-primary">{value}</span>
    </div>
  )
}
