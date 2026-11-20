import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import { ThemeToggle } from '#/components/application/theme/theme-toggle'

export interface LegalSection {
  id: string
  title: string
  body: ReactNode
}

interface LegalPageProps {
  siteName: string
  logoUrl: string | null
  title: string
  summary: string
  updatedAt: string
  sections: LegalSection[]
  contactEmail: string | null
  other: { to: '/terms' | '/privacy'; label: string }
}

/** 条款正文的段落：和首页一样用 16px 行文，长文读起来不挤。 */
export function LegalP({ children }: { children: ReactNode }) {
  return (
    <p className="text-pretty text-headline-regular leading-relaxed text-text-secondary">
      {children}
    </p>
  )
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 ps-5 text-headline-regular leading-relaxed text-text-secondary marker:text-text-tertiary">
      {items.map((item, index) => (
        <li key={index} className="ps-1 text-pretty">
          {item}
        </li>
      ))}
    </ul>
  )
}

/** 需要单独强调的一段（免责、边界说明），不参与编号。 */
export function LegalNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-separator-border bg-background-secondary-default p-4 text-body-regular leading-relaxed text-text-secondary">
      {children}
    </div>
  )
}

function SectionNumber({ value }: { value: number }) {
  return (
    <span className="font-mono text-caption-1-semibold text-text-tertiary">
      {String(value).padStart(2, '0')}
    </span>
  )
}

export function LegalPage({
  siteName,
  logoUrl,
  title,
  summary,
  updatedAt,
  sections,
  contactEmail,
  other,
}: LegalPageProps) {
  const year = new Date().getFullYear()

  return (
    <div className="min-h-dvh bg-background-full text-text-primary">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 md:px-10">
        <header className="flex items-center justify-between gap-4 pt-6 md:pt-8">
          <Link
            to="/"
            aria-label={`${siteName} 首页`}
            className="flex items-center gap-2.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
          >
            {logoUrl ? (
              <img
                src={logoUrl}
                alt=""
                className="size-5.5 shrink-0 object-contain"
              />
            ) : null}
            <span className="text-title-3-semibold tracking-[-0.01em] text-text-primary">
              {siteName}
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle appearance="segmented" size="small" />
            <Link
              to="/"
              className="rounded-sm px-1 text-body-regular text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
            >
              返回首页
            </Link>
          </div>
        </header>

        <main className="flex-1 pt-14 pb-16 md:pt-20 md:pb-24">
          <p className="text-caption-1-semibold text-text-tertiary uppercase">
            Legal
          </p>
          <h1 className="mt-3 text-title-1-medium tracking-[-0.01em] text-text-primary md:text-display-4-medium">
            {title}
          </h1>
          <p className="mt-4 max-w-[34rem] text-pretty text-headline-regular leading-relaxed text-text-secondary">
            {summary}
          </p>
          <p className="mt-3 font-mono text-caption-2-regular text-text-tertiary">
            最后更新：{updatedAt}
          </p>

          <div className="mt-10 grid gap-10 md:mt-14 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
            <nav aria-label="目录" className="hidden lg:block">
              <div className="sticky top-10 flex flex-col gap-1.5 border-s border-separator-border ps-4">
                {sections.map((section, index) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="flex items-baseline gap-2 rounded-sm text-body-2-regular text-text-tertiary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                  >
                    <SectionNumber value={index + 1} />
                    <span className="text-text-secondary">{section.title}</span>
                  </a>
                ))}
              </div>
            </nav>

            <article className="flex max-w-[38rem] flex-col gap-10">
              {sections.map((section, index) => (
                <section
                  key={section.id}
                  id={section.id}
                  className="scroll-mt-8"
                >
                  <h2 className="flex items-baseline gap-3 text-title-3-semibold text-text-primary">
                    <SectionNumber value={index + 1} />
                    {section.title}
                  </h2>
                  <div className="mt-3 flex flex-col gap-3">{section.body}</div>
                </section>
              ))}
            </article>
          </div>
        </main>

        <footer className="border-t border-separator-border py-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-caption-1-regular text-text-secondary">
            <p>
              © {year} {siteName}
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {contactEmail ? (
                <a
                  href={`mailto:${contactEmail}`}
                  dir="ltr"
                  className="rounded-sm font-mono outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                >
                  {contactEmail}
                </a>
              ) : null}
              <Link
                to={other.to}
                className="rounded-sm outline-none hover:text-text-primary hover:underline hover:underline-offset-3 focus-visible:ring-2 focus-visible:ring-border-focus-ring"
              >
                {other.label}
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
