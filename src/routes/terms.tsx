import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'

import {
  LegalList,
  LegalNotice,
  LegalP,
  LegalPage,
} from '#/components/marketing/legal-page'
import type { LegalSection } from '#/components/marketing/legal-page'

const rootApi = getRouteApi('__root__')

export const Route = createFileRoute('/terms')({
  head: () => ({ meta: [{ title: '服务条款' }] }),
  component: TermsPage,
})

function TermsPage() {
  const { site } = rootApi.useLoaderData()
  const ttl = site.tempTtlMinutes

  const sections: LegalSection[] = [
    {
      id: 'scope',
      title: '这份条款管什么',
      body: (
        <>
          <LegalP>
            你访问、注册或使用 {site.siteName}
            （下称「本站」）时，就表示你接受这份条款。本站由运营者自行部署和维护，不是邮件投递服务商：发信交给第三方邮件
            API，收信由服务商代收后回推。因此本站能做什么、不能做什么，都跟着这条链路走。
          </LegalP>
          <LegalP>
            如果你不同意这些内容，请不要注册或继续使用。已经注册的，可以随时停止使用并联系我们处理数据。
          </LegalP>
        </>
      ),
    },
    {
      id: 'account',
      title: '账号',
      body: (
        <>
          <LegalP>
            本站支持邮箱密码、Google / GitHub / 通用 OIDC 以及 Passkey
            登录，具体开放哪些方式由管理员配置。开启邮箱验证时，注册后要先点邮件里的链接才能进入邮箱。
          </LegalP>
          <LegalList
            items={[
              '账号只给你自己用，不要把登录凭据交给别人，也不要共用一个账号收不同人的信。',
              '注册时填写的信息要真实可用，尤其是找回密码依赖的邮箱。',
              '本站可能因维护、滥用处置或运营调整暂停账号，动到你的账号时会记下原因。',
            ]}
          />
        </>
      ),
    },
    {
      id: 'mailbox',
      title: '邮箱地址',
      body: (
        <>
          <LegalP>
            {`长期邮箱按配额创建，前缀至少 ${site.permanentPrefixMin} 位；临时邮箱前缀至少 ${site.tempPrefixMin} 位。前缀只允许小写字母和数字，长度上限 ${site.prefixMax} 位。`}
          </LegalP>
          <LegalP>
            {`临时邮箱在创建后有 ${ttl} 分钟考察期，这段时间里收到任意一封邮件，它就会永久保留；一封都没收到，地址到期作废，不续期也不复活。所以临时地址不适合放重要的、需要过很久才来信的场景。`}
          </LegalP>
          <LegalList
            items={[
              'postmaster、abuse、admin、privacy 这类保留前缀只有管理员能注册，普通用户注册不了。',
              '删除的地址有冷却期，冷却结束前不能重新注册同一个地址。',
              '地址属于本站的域名，不是你的财产；域名或服务商变更、站点关停时，地址可能随之失效。',
              '管理员可以调整配额、关闭某个域名的创建开关，但只对新地址生效。',
            ]}
          />
        </>
      ),
    },
    {
      id: 'sending',
      title: '发信',
      body: (
        <>
          <LegalP>
            发信会占用每日配额，配额按站点时区切日重置。发信必须走域名绑定的服务商，且该域名在你发送时处于已验证、已开启发信的状态。临时邮箱默认不能发信，是否放开由管理员决定。
          </LegalP>
          <LegalP>
            发送成功只代表服务商接受了这封信，不代表对方收到、打开或不会进垃圾箱。退信和投诉由服务商回传，本站只能记录状态。
          </LegalP>
        </>
      ),
    },
    {
      id: 'receiving',
      title: '收信与拒收',
      body: (
        <>
          <LegalP>
            本站不是 MTA，没有 SMTP / IMAP
            服务。发往已删除、已过期或不存在地址的邮件，本站无法在投递阶段退回给发件人，只能丢弃并留一条记录，接口仍然返回成功。
          </LegalP>
          <LegalList
            items={[
              '一封邮件命中本站多个地址时，只会投进第一个命中的邮箱，其余地址记在收件人列表里。',
              '发往保留前缀的邮件统一转投同域名的 admin@；该地址不存在时按无法投递处理。',
              '附件目前只保存文件名、大小等信息，下载功能还没有。',
            ]}
          />
        </>
      ),
    },
    {
      id: 'prohibited',
      title: '禁止用途',
      body: (
        <>
          <LegalP>
            以下行为会被直接处置，包括但不限于停用邮箱、封禁账号、清空数据：
          </LegalP>
          <LegalList
            items={[
              '发送垃圾邮件、钓鱼邮件、诈骗信息，或冒充他人、冒充官方身份。',
              '批量注册账号、批量开临时地址来绕过配额、限流或服务商的风控。',
              '把地址用于违法交易、恶意软件分发、骚扰或任何违反所在地法律的事情。',
              '攻击本站或其他系统：探测漏洞、绕过鉴权、压测接口、用 API 做与收发无关的抓取。',
              '违反上游邮件服务商的使用政策，导致本站域名或账号被处罚。',
            ]}
          />
          <LegalP>本站的自动化接口带限流，刻意规避限流本身也属于滥用。</LegalP>
        </>
      ),
    },
    {
      id: 'content',
      title: '内容与保管',
      body: (
        <>
          <LegalP>
            邮件的著作权归原权利人，本站不主张任何权利，只为投递和展示而存储。你需要自己判断收到的内容是否可信，尤其是附件、链接和验证码。
          </LegalP>
          <LegalP>
            本站按站点配置的保留策略清理数据：回收站、无法投递的记录、已删除的邮箱都会在保留期结束后清掉，清了就找不回来。重要的邮件请自己备份。
          </LegalP>
        </>
      ),
    },
    {
      id: 'availability',
      title: '可用性',
      body: (
        <>
          <LegalNotice>
            本站是自托管项目，不提供
            SLA，也不保证不中断。升级、迁移、上游服务商故障、网络或域名解析问题都可能让收发暂停，甚至让某个地址失效。
          </LegalNotice>
          <LegalP>
            临时邮箱尤其如此：它的价值就在于短命，别把它当成长期联系方式。
          </LegalP>
        </>
      ),
    },
    {
      id: 'liability',
      title: '责任范围',
      body: (
        <>
          <LegalP>
            在法律允许的范围内，本站不对因使用或无法使用服务造成的间接损失负责，包括利润、业务、数据丢失等。因你违反本条款或滥用服务导致的索赔、处罚，由你承担。
          </LegalP>
          <LegalP>
            本站可能包含指向第三方服务（邮件服务商、登录平台、Telegram）的链接或跳转，这些服务有自己的条款和隐私政策，不由本站控制。
          </LegalP>
        </>
      ),
    },
    {
      id: 'changes',
      title: '条款变更与联系',
      body: (
        <>
          <LegalP>
            条款可能随功能调整而更新，更新后会在本页标注日期。继续使用即视为接受新版本；如果不接受，请停止使用并联系我们删除数据。
          </LegalP>
          <LegalP>
            对条款有疑问、要举报滥用或申请删除账号，可以通过
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
            联系运营者。数据处理的具体做法见
            <Link
              to="/privacy"
              className="rounded-sm text-accent-600 underline-offset-3 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring"
            >
              隐私政策
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
      title="服务条款"
      summary="本站怎么用、能做什么、不能做什么，以及出了问题怎么算。条款跟着实现走，不写做不到的承诺。"
      updatedAt="2026-11-20"
      sections={sections}
      contactEmail={site.contactEmail}
      other={{ to: '/privacy', label: '隐私政策' }}
    />
  )
}
