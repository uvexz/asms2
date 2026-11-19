import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { RiArrowRightLine } from '@remixicon/react'

import { ThemeToggle } from '@/components/application/theme/theme-toggle'
import { buttonStyles } from '@/components/base/buttons/button'
import {
  linkButtonStyles,
  LinkButton,
} from '@/components/base/buttons/link-button'
import { cx } from '@/utils/cx'

import {
  ApiExhibit,
  InboxExhibit,
  ProviderExhibit,
  TelegramExhibit,
  TempExhibit,
} from './landing-exhibits'

interface LandingSite {
  siteName: string
  siteDescription: string
  logoUrl: string | null
  footerText: string | null
  registrationEnabled: boolean
  tempTtlMinutes: number
  tempPrefixMin: number
}

interface LandingPageProps {
  site: LandingSite | null
  signedIn: boolean
}

/** 60 → 一小时，120 → 两小时，30 → 30 分钟：站点把 TTL 改了，文案跟着改。 */
function ttlLabel(minutes: number) {
  if (minutes === 60) return '一小时'
  if (minutes === 120) return '两小时'
  if (minutes > 60 && minutes % 60 === 0) return `${minutes / 60} 小时`
  return `${minutes} 分钟`
}

function Mark() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      aria-hidden
      className="shrink-0 text-text-primary"
    >
      <rect
        x="1.7"
        y="4.3"
        width="18.6"
        height="13.4"
        rx="3.4"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M2.6 6.6 11 12.1l8.4-5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Mono({ children }: { children: ReactNode }) {
  return (
    <span dir="ltr" className="font-mono text-body-2-medium text-text-primary">
      {children}
    </span>
  )
}

const CTA_CLASS = cx(
  buttonStyles.base,
  buttonStyles.size.medium,
  buttonStyles.variant.primary,
)

const QUIET_LINK_CLASS = cx(
  linkButtonStyles.base,
  linkButtonStyles.size.medium,
  linkButtonStyles.variant.secondary,
)

function PrimaryCta({
  signedIn,
  registrationEnabled,
  children,
}: {
  signedIn: boolean
  registrationEnabled: boolean
  children: ReactNode
}) {
  const label = <span className={buttonStyles.label.medium}>{children}</span>

  if (signedIn) {
    return (
      <Link to="/mail" search={{ folder: 'inbox' }} className={CTA_CLASS}>
        {label}
      </Link>
    )
  }

  if (registrationEnabled) {
    return (
      <Link to="/register" className={CTA_CLASS}>
        {label}
      </Link>
    )
  }

  return (
    <Link to="/login" className={CTA_CLASS}>
      {label}
    </Link>
  )
}

/**
 * 章节头用「窄标题栏 + 宽正文栏」的文档网格：标题像手册里的页边小标题，
 * 说明文字在右侧成段，图版独占整行——邮件界面需要横向空间。
 */
function Section({
  id,
  title,
  copy,
  children,
}: {
  id: string
  title: string
  copy: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} className="landing-reveal mt-20 scroll-mt-10 md:mt-32">
      <div className="grid gap-3 md:grid-cols-[17rem_minmax(0,1fr)] md:gap-12">
        <h2 className="text-balance text-pretty text-title-2-semibold text-text-primary">
          {title}
        </h2>
        <div className="flex max-w-[34rem] flex-col gap-3.5 text-pretty text-headline-regular leading-relaxed text-text-primary">
          {copy}
        </div>
      </div>
      <div className="mt-8 md:mt-10">{children}</div>
    </section>
  )
}

const LIMITS = [
  {
    title: '没有 SMTP / IMAP',
    note: '发件走服务商 API，收件由对方代收后回传。地址背后没有一台等你的服务器。',
  },
  {
    title: '拒收不了',
    note: '地址不存在或已过期时，邮件只能丢弃并记录，接口仍然返回 200。',
  },
  {
    title: '附件只有元数据',
    note: '能看到文件名和大小，暂时下载不了。',
  },
  {
    title: '没有全文检索',
    note: '搜索只匹配主题和发件人，不翻正文。',
  },
  {
    title: '没有会话线程',
    note: '同一主题的来信各自独立，不会折叠成一串。',
  },
  {
    title: '管理员读不到正文',
    note: '默认如此，要开也得自己去后台打开。',
  },
]

export function LandingPage({ site, signedIn }: LandingPageProps) {
  const siteName = site?.siteName ?? 'asms2'
  const description = site?.siteDescription ?? 'A Simple Mail Server'
  const registrationEnabled = site?.registrationEnabled ?? true
  const ttl = ttlLabel(site?.tempTtlMinutes ?? 60)
  const tempPrefixMin = site?.tempPrefixMin ?? 8
  const year = new Date().getFullYear()

  return (
    <div className="min-h-dvh bg-background-full text-text-primary">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 md:px-10">
        <header className="flex items-center justify-between gap-4 pt-6 md:pt-8">
          <Link
            to="/"
            aria-label={siteName}
            className="flex items-center gap-2.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
          >
            {site?.logoUrl ? (
              <img
                src={site.logoUrl}
                alt=""
                className="size-5.5 shrink-0 object-contain"
              />
            ) : (
              <Mark />
            )}
            <span className="text-title-3-semibold tracking-[-0.01em] text-text-primary">
              {siteName}
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <ThemeToggle appearance="segmented" size="small" />
            <Link
              to={signedIn ? '/mail' : '/login'}
              search={signedIn ? { folder: 'inbox' } : undefined}
              className={QUIET_LINK_CLASS}
            >
              {signedIn ? '进入邮箱' : '登录'}
            </Link>
          </div>
        </header>

        <main className="flex flex-col">
          <section className="pt-16 md:pt-24" aria-labelledby="landing-title">
            <h1
              id="landing-title"
              className="landing-enter text-display-3-medium tracking-[-0.02em] text-text-primary md:text-display-2-medium"
              style={{ animationDelay: '40ms' }}
            >
              <span className="block">简单收发件，</span>
              <span className="block">你的简单邮箱专家。</span>
            </h1>

            <p
              className="landing-enter mt-6 max-w-[34rem] text-balance text-title-3-regular leading-relaxed text-text-primary"
              style={{ animationDelay: '120ms' }}
            >
              {`${siteName} 的收发都在网页里，不用装客户端。临时地址不限量，长期地址按配额给：开好后${ttl}内，收到任意一封邮件就永久保留；一封都没等到，就作废。`}
            </p>

            <div
              className="landing-enter mt-8 flex flex-wrap items-center gap-x-6 gap-y-3"
              style={{ animationDelay: '200ms' }}
            >
              <PrimaryCta
                signedIn={signedIn}
                registrationEnabled={registrationEnabled}
              >
                {signedIn
                  ? '进入邮箱'
                  : registrationEnabled
                    ? '创建邮箱'
                    : '登录'}
              </PrimaryCta>
              <LinkButton
                href={signedIn ? '/mail?folder=inbox' : '/login'}
                variant="secondary"
                trailingIcon={RiArrowRightLine}
              >
                {signedIn ? '继续收件' : '已有账号，去登录'}
              </LinkButton>
            </div>

            <p
              className="landing-enter mt-6 font-mono text-caption-2-regular text-text-secondary"
              style={{ animationDelay: '260ms' }}
            >
              temp_ttl={site?.tempTtlMinutes ?? 60}m · prefix_min=
              {tempPrefixMin} · no SMTP/IMAP
            </p>
          </section>

          <div
            className="landing-enter mt-12 md:mt-14"
            style={{ animationDelay: '320ms' }}
          >
            <InboxExhibit />
          </div>

          <Section
            id="temp"
            title={`${ttl}，够收一封验证码了。`}
            copy={
              <>
                <p>
                  临时地址创建后开始计时。这段时间里收到任意一封邮件——验证码、账单、推广都算——它就直接转正，计时器当场消失。
                </p>
                <p>一封都没收到，地址作废——不续期，不复活，也不重新分配。</p>
              </>
            }
          >
            <TempExhibit ttlLabel={ttl} />
          </Section>

          <Section
            id="telegram"
            title="验证码不用手抄。"
            copy={
              <>
                <p>
                  绑定 Telegram
                  之后，新邮件推到私聊：发件人、主题、摘要，识别到验证码就单独拎出来放在最上面。
                </p>
                <p>
                  也能在对话里直接 <Mono>/new</Mono>{' '}
                  建一个临时地址，不用打开网页。Bot
                  只处理私聊，群组消息一律拒绝。
                </p>
              </>
            }
          >
            <TelegramExhibit />
          </Section>

          <Section
            id="providers"
            title="换服务商，不用换界面。"
            copy={
              <>
                <p>
                  发件走 Resend、AhaSend、UnitPost 这些 API，收件由对方代收后
                  webhook 回推。同一个域名换服务商，地址、邮件和历史都不动。
                </p>
                <p>
                  每个域名单独控制能不能新建长期或临时地址，也能单独关掉发件。开关只管新建，不动已有的邮箱。
                </p>
              </>
            }
          >
            <ProviderExhibit />
          </Section>

          <Section
            id="api"
            title="也能当基础设施用。"
            copy={
              <>
                <p>
                  API Key 鉴权，三个接口：建邮箱、发信、读邮件。Key
                  只显示一次，以哈希存储，可以设过期时间和限流。
                </p>
                <p>错误码、限流规则、字段约束都写在文档里，不用猜。</p>
              </>
            }
          >
            <ApiExhibit />
          </Section>

          <Section
            id="limits"
            title="我们没做什么。"
            copy={<p>这些是故意留白的，不是排期问题。</p>}
          >
            <dl className="grid gap-px overflow-hidden rounded-2xl border border-separator-border bg-separator-border sm:grid-cols-2">
              {LIMITS.map((item) => (
                <div key={item.title} className="bg-background-full p-5">
                  <dt className="text-body-medium text-text-primary">
                    {item.title}
                  </dt>
                  <dd className="mt-1.5 text-body-2-regular text-text-secondary">
                    {item.note}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>

          <section
            className="landing-reveal mt-20 border-t border-separator-border pt-10 md:mt-32"
            aria-labelledby="closing-title"
          >
            <h2
              id="closing-title"
              className="text-title-1-medium tracking-[-0.01em] text-text-primary md:text-display-4-medium"
            >
              就这些。剩下的都在界面里。
            </h2>
            <p className="mt-3 max-w-[34rem] text-balance text-headline-regular leading-relaxed text-text-secondary">
              如果只是想收一封验证码，现在就能开一个地址；
              <br className="hidden md:inline" />
              要用 API 的，Key 在设置页里自己建。
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
              <PrimaryCta
                signedIn={signedIn}
                registrationEnabled={registrationEnabled}
              >
                {signedIn
                  ? '进入邮箱'
                  : registrationEnabled
                    ? '创建邮箱'
                    : '登录'}
              </PrimaryCta>
            </div>
          </section>

          <footer className="mt-20 border-t border-separator-border py-8 md:mt-28">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-caption-1-regular text-text-secondary">
              <p>
                © {year} {siteName}
              </p>
              <p>{site?.footerText ?? description}</p>
            </div>
          </footer>
        </main>
      </div>
    </div>
  )
}
