import { escapeHtml } from '#/server/mail/content'
import { sendSystemMail } from '#/server/mail/system'

export async function sendVerificationEmail(input: {
  siteName: string
  to: string
  url: string
}) {
  const subject = `验证你的邮箱 · ${input.siteName}`
  const text = [
    `你好，`,
    ``,
    `请点击下面的链接验证你的邮箱地址：`,
    input.url,
    ``,
    `链接 1 小时内有效。如果不是你本人操作，忽略这封邮件即可。`,
    ``,
    `— ${input.siteName}`,
  ].join('\n')

  const safeName = escapeHtml(input.siteName)
  const safeUrl = escapeHtml(input.url)
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#1f2937">
<p>你好，</p>
<p>请点击下面的按钮验证你的邮箱地址：</p>
<p><a href="${safeUrl}" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:500">验证邮箱</a></p>
<p style="color:#6b7280;font-size:13px">如果按钮无法点击，请复制以下链接到浏览器打开：<br /><span style="word-break:break-all">${safeUrl}</span></p>
<p style="color:#6b7280;font-size:13px">链接 1 小时内有效。如果不是你本人操作，忽略这封邮件即可。</p>
<p style="color:#9ca3af;font-size:13px">— ${safeName}</p>
</div>`

  await sendSystemMail({ to: input.to, subject, text, html })
}
