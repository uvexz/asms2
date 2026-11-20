import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'

import {
  LegalList,
  LegalNotice,
  LegalP,
  LegalPage,
} from '#/components/marketing/legal-page'
import type { LegalSection } from '#/components/marketing/legal-page'

const rootApi = getRouteApi('__root__')

export const Route = createFileRoute('/privacy')({
  head: () => ({ meta: [{ title: '隐私政策' }] }),
  component: PrivacyPage,
})

function PrivacyPage() {
  const { site } = rootApi.useLoaderData()

  const sections: LegalSection[] = [
    {
      id: 'who',
      title: '谁在处理你的数据',
      body: (
        <>
          <LegalP>
            {site.siteName}{' '}
            是自行部署的邮件应用，运营者就是本页所在域名的维护方。账号、邮箱和邮件都存在这个实例自己的数据库里，没有别的中心服务经手。
          </LegalP>
          <LegalP>
            只有一个例外：发信和收信要经过你所在站点绑定的第三方邮件服务商，邮件内容会被送到对方那里处理。这部分的处理受服务商自己的隐私政策约束。
          </LegalP>
        </>
      ),
    },
    {
      id: 'collect',
      title: '我们存了什么',
      body: (
        <>
          <LegalP>本站只收集让收发件能跑起来的数据。</LegalP>
          <LegalList
            items={[
              '账号：邮箱地址、昵称、头像地址、密码哈希（服务端不保存明文密码）、角色与配额。',
              '第三方登录：对应平台返回的账号标识和令牌；Passkey 只保存公钥与签名计数器，不保存可用于冒充你的私钥。',
              '会话：会话令牌、过期时间、登录时的 IP 与浏览器标识（User-Agent），用于维持登录和处理封禁。',
              '邮箱地址：前缀、所属域名、类型（长期 / 临时）、状态与时间戳。',
              '邮件：发件人、收件人、抄送、主题、摘要、状态、时间、正文（HTML 脱敏后与纯文本各一份）、原始头信息，以及附件的文件名、大小、类型。',
              '使用记录：每日发件计数、服务商回传的投递状态、Webhook 事件记录、管理员的配置修改与封禁操作日志。',
            ]}
          />
          <LegalP>
            使用统计只按天聚合发件数量，不做用户画像，也没有接入第三方统计、广告或行为分析脚本。
          </LegalP>
        </>
      ),
    },
    {
      id: 'why',
      title: '为什么用这些数据',
      body: (
        <LegalList
          items={[
            '把邮件投递到正确的邮箱、展示在界面上，并让你能搜索和归档。',
            '验证账号归属、维持登录状态、找回密码。',
            '执行配额与限流，识别滥用，避免本站域名被服务商处罚。',
            '排查投递失败，处理你提出的问题。',
          ]}
        />
      ),
    },
    {
      id: 'processors',
      title: '谁会看到',
      body: (
        <>
          <LegalP>
            本站不卖数据，也不把邮件用于广告。为了完成收发，以下对象会在必要范围内接触数据：
          </LegalP>
          <LegalList
            items={[
              '邮件服务商：你所在站点绑定的发信与收件服务商，会处理邮件内容、收发件地址和投递状态。',
              '登录平台：使用 Google、GitHub 或通用 OIDC 登录时，对方会告知本站你的账号标识与邮箱。',
              'Telegram：开启推送后，新邮件的发件人、主题、摘要（以及识别到的验证码）会发送到你自己绑定的私聊。这是你主动开启的功能，可以随时关掉。',
              '实例运维者：能接触数据库的人。管理员默认看不到邮件正文，登录与后台操作会写审计日志。',
              '法律要求：收到有效的司法或行政机关要求时，会按对方要求的范围提供数据。',
            ]}
          />
          <LegalNotice>
            临时邮箱常被用来收验证码，所以请不要把身份证件、银行卡、密码这类信息寄到本站邮箱里。邮件在服务商和数据库里都是明文可读的，本站不做端到端加密。
          </LegalNotice>
        </>
      ),
    },
    {
      id: 'retention',
      title: '存多久',
      body: (
        <>
          <LegalP>
            数据不是永久保留，下面这些期限由站点配置决定，这里显示的是当前实例的实际值。
          </LegalP>
          <LegalList
            items={[
              `临时邮箱：创建后 ${site.tempTtlMinutes} 分钟内收到任意一封邮件即永久保留；没收到就失效，之后再经过一段宽限期清空邮件，只留一条用于地址冷却的记录。`,
              `回收站：删除的邮件保留 ${site.trashRetentionDays} 天，之后清掉。`,
              `无法投递的邮件：保留 ${site.orphanRetentionDays} 天，用于排查地址不存在或域名已关闭的情况。`,
              `已删除的邮箱：保留至少 ${site.deletedMailboxRetentionDays} 天，并且要等地址冷却期结束才会彻底删除，期间地址不会分配给其他人。`,
              'Webhook 事件记录保留 30 天；Telegram 的去重记录与绑定码保留 1 天；每日发件计数保留 90 天。',
              '会话与验证记录在过期后由定时任务清理。',
            ]}
          />
          <LegalP>
            账号本身不会自动过期。要注销账号并删除关联数据，请通过本页底部的联系方式提出申请。
          </LegalP>
        </>
      ),
    },
    {
      id: 'security',
      title: '怎么保护',
      body: (
        <>
          <LegalList
            items={[
              '服务商 API Key、OAuth Secret、Webhook 签名密钥只以加密形式保存，界面上只显示末四位。',
              '收件 HTML 入库前会先做脱敏，页面里用受限的 iframe 渲染，脚本不能在你的登录态下执行。',
              '对外 API 使用独立的 Key 鉴权，Key 只显示一次，可按 Key 设置限流。',
              '所有面板查询都限定在当前用户自己的数据范围内；管理员操作会记录操作人与时间。',
            ]}
          />
          <LegalP>
            安全没有绝对。如果你怀疑账号或某个 API Key 泄露，请立即吊销
            Key、修改密码，并联系我们。
          </LegalP>
        </>
      ),
    },
    {
      id: 'rights',
      title: '你的选择',
      body: (
        <>
          <LegalList
            items={[
              '在个人设置里修改昵称、绑定或解绑第三方登录、创建和吊销 API Key。',
              '随时关闭 Telegram 推送或解绑会话。',
              '删除不再需要的邮箱和邮件；删除后按上面的保留策略清理。',
              '联系我们查询、导出或删除账号相关的数据。',
            ]}
          />
          <LegalP>
            有两点得说明白：为了防滥用和排查问题，你提的删除请求处理完之后，审计和不可投递记录会在各自的保留期内继续存在；另外，邮件一旦投出去、进了对方服务商或收件人的邮箱，本站就删不掉了。
          </LegalP>
        </>
      ),
    },
    {
      id: 'cookies',
      title: 'Cookie 与本地存储',
      body: (
        <>
          <LegalP>
            本站使用必要的 Cookie
            保存登录会话和防跨站请求的校验信息。浏览器本地存储里只记一个键，用来记住你选的是浅色还是深色主题。没有广告或追踪用的
            Cookie。
          </LegalP>
          <LegalP>
            清掉这些数据等于退出登录、主题偏好回到跟随系统，不影响账号本身。
          </LegalP>
        </>
      ),
    },
    {
      id: 'changes',
      title: '变更与联系',
      body: (
        <>
          <LegalP>
            功能或保留策略变化时，这份政策会跟着更新并在这里标注日期。对数据处理有疑问、要行使上面的权利，或想举报滥用，可以通过
            {site.contactEmail ? (
              <>
                {' '}
                <a
                  href={`mailto:${site.contactEmail}`}
                  dir="ltr"
                  className="rounded-sm font-mono text-accent-600 underline-offset-3 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                >
                  {site.contactEmail}
                </a>{' '}
              </>
            ) : (
              '站点公布的联系方式'
            )}
            联系运营者。账号使用的规则见
            <Link
              to="/terms"
              className="rounded-sm text-accent-600 underline-offset-3 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring"
            >
              服务条款
            </Link>
            。
          </LegalP>
        </>
      ),
    },
  ]

  return (
    <LegalPage
      siteName={site.siteName}
      logoUrl={site.logoUrl}
      title="隐私政策"
      summary="存了哪些数据、为什么存、谁会看到、存多久。保留期限读的是这个站点的实际配置，不是模板里的固定数字。"
      updatedAt="2026-11-20"
      sections={sections}
      contactEmail={site.contactEmail}
      other={{ to: '/terms', label: '服务条款' }}
    />
  )
}
