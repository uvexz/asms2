import { RiFingerprintLine, RiLinkM } from '@remixicon/react'

import { Button } from '#/components/base/buttons/button'
import { SocialButton } from '#/components/base/social-button/social-button'

export interface LoginSocialMethod {
  /** 运行时 ID，也是回调路径段 */
  providerId: string
  kind: 'google' | 'github' | 'oidc'
  displayName: string
}

/**
 * 登录/注册页的方法按钮：Google、GitHub 用品牌按钮，通用 OIDC 与 Passkey
 * 用普通按钮（没有品牌图标）。顺序与管理员配置一致。
 */
export function LoginMethodButtons({
  social,
  passkeyEnabled,
  action = '登录',
  onSocial,
  onPasskey,
}: {
  social: LoginSocialMethod[]
  passkeyEnabled: boolean
  action?: '登录' | '继续'
  onSocial: (providerId: string) => void
  onPasskey: () => void
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {social.map((method) =>
        method.kind === 'oidc' ? (
          <Button
            key={method.providerId}
            variant="secondary"
            className="w-full justify-center"
            leadingIcon={RiLinkM}
            onClick={() => onSocial(method.providerId)}
          >
            使用 {method.displayName} {action}
          </Button>
        ) : (
          <SocialButton
            key={method.providerId}
            brand={method.kind}
            appearance="white"
            fullWidth
            onClick={() => onSocial(method.providerId)}
          >
            {`使用 ${method.displayName} ${action}`}
          </SocialButton>
        ),
      )}

      {passkeyEnabled ? (
        <Button
          variant="secondary"
          className="w-full justify-center"
          leadingIcon={RiFingerprintLine}
          onClick={onPasskey}
        >
          使用 Passkey {action}
        </Button>
      ) : null}
    </div>
  )
}
