import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  RiArrowLeftLine,
  RiAttachment2,
  RiCornerUpLeftLine,
  RiDeleteBinLine,
  RiMailOpenLine,
  RiMailUnreadLine,
  RiStarFill,
  RiStarLine,
} from '@remixicon/react'

import { Button } from '@/components/base/buttons/button'
import { IconButton } from '@/components/base/buttons/icon-button'
import { Chip } from '@/components/base/badges/chip'
import { Divider } from '@/components/base/divider/divider'
import { Spinner } from '@/components/base/spinner/spinner'
import { toast } from '@/components/base/toast/toast'
import {
  formatBytes,
  formatDateTime,
  patchMessageCaches,
  removeMessageFromCaches,
  unwrap,
} from '#/lib/api'
import { getMessageFn, updateMessageFn } from '#/server/fns/mail'
import type { MailboxView } from '#/server/mail/mailbox'

import { useCompose } from './compose-context'

function buildSrcDoc(html: string, allowRemoteImages: boolean) {
  const imgSrc = allowRemoteImages
    ? "'self' https: http: data: cid:"
    : 'data: cid:'
  return `<!doctype html><html><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:;" />
<base target="_blank" />
<style>
  html,body{margin:0;padding:16px;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#1f2937;background:#fff;word-break:break-word;}
  img{max-width:100%;height:auto;} table{max-width:100%;border-collapse:collapse;}
  a{color:#185fa5;} blockquote{margin:0;padding-left:12px;border-left:3px solid #e5e7eb;color:#4b5563;}
  pre{white-space:pre-wrap;word-break:break-word;}
</style></head><body>${html}</body></html>`
}

export function MessageReader({
  messageId,
  mailboxes,
}: {
  messageId: string
  mailboxes: MailboxView[]
}) {
  const navigate = useNavigate({ from: '/mail' })
  const queryClient = useQueryClient()
  const { openCompose } = useCompose()
  const [allowImages, setAllowImages] = useState(false)
  const markUnreadId = useRef<string | null>(null)

  useEffect(() => {
    markUnreadId.current = null
  }, [messageId])

  const query = useQuery({
    queryKey: ['message', messageId],
    queryFn: async () =>
      unwrap(await getMessageFn({ data: { id: messageId } })),
    staleTime: 30_000,
  })

  const message = query.data

  useEffect(() => {
    if (!message || message.isRead) return
    if (markUnreadId.current === message.id) return
    void updateMessageFn({ data: { id: message.id, isRead: true } }).then(
      async (result) => {
        if (result.ok) {
          patchMessageCaches(queryClient, message.id, { isRead: true })
          await queryClient.invalidateQueries({ queryKey: ['mailboxes'] })
        }
      },
    )
  }, [message, queryClient])

  const srcDoc = useMemo(
    () => (message?.html ? buildSrcDoc(message.html, allowImages) : ''),
    [message?.html, allowImages],
  )

  if (query.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (!message) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-body-regular text-text-tertiary">
        邮件不存在或已被删除
      </div>
    )
  }

  const fromMailbox = mailboxes.find((item) => item.id === message.mailboxId)

  async function act(action: 'trash' | 'unread' | 'star') {
    if (!message) return
    const data =
      action === 'trash'
        ? { id: message.id, folder: 'trash' as const }
        : action === 'unread'
          ? { id: message.id, isRead: false }
          : { id: message.id, isStarred: !message.isStarred }

    const result = await updateMessageFn({ data })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }

    if (action === 'trash') {
      removeMessageFromCaches(queryClient, message.id)
      await queryClient.invalidateQueries({ queryKey: ['mailboxes'] })
      toast.success('已移入回收站')
      void navigate({ to: '/mail', search: (prev) => ({ ...prev }) })
      return
    }

    if (action === 'unread') {
      markUnreadId.current = message.id
      patchMessageCaches(queryClient, message.id, { isRead: false })
      await queryClient.invalidateQueries({ queryKey: ['mailboxes'] })
      return
    }

    patchMessageCaches(queryClient, message.id, {
      isStarred: !message.isStarred,
    })
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background-primary-default">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-separator-border px-3">
        <IconButton
          className="md:hidden"
          size="small"
          icon={RiArrowLeftLine}
          aria-label="返回列表"
          onClick={() =>
            void navigate({ to: '/mail', search: (prev) => ({ ...prev }) })
          }
        />
        <IconButton
          size="small"
          icon={RiCornerUpLeftLine}
          aria-label="回复"
          disabled={!fromMailbox}
          onClick={() => {
            if (!fromMailbox) return
            openCompose({
              fromMailboxId: fromMailbox.id,
              to: message.fromAddress,
              subject: message.subject?.startsWith('Re:')
                ? message.subject
                : `Re: ${message.subject ?? ''}`,
            })
          }}
        />
        <IconButton
          size="small"
          icon={message.isStarred ? RiStarFill : RiStarLine}
          aria-label={message.isStarred ? '取消星标' : '加星标'}
          onClick={() => void act('star')}
        />
        <IconButton
          size="small"
          icon={RiMailUnreadLine}
          aria-label="标记未读"
          onClick={() => void act('unread')}
        />
        <IconButton
          size="small"
          icon={RiDeleteBinLine}
          aria-label="移入回收站"
          onClick={() => void act('trash')}
        />
        <div className="flex-1" />
        <span className="hidden text-caption-1-regular text-text-tertiary md:block">
          {formatDateTime(message.receivedAt)}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-5 lg:p-8">
          <div className="flex flex-col gap-1">
            <h1 className="text-title-3-semibold text-text-primary">
              {message.subject || '(无主题)'}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption-1-regular text-text-tertiary">
              <span className="text-body-medium text-text-secondary">
                {message.fromName || message.fromAddress}
              </span>
              <span>&lt;{message.fromAddress}&gt;</span>
              {message.to.length > 0 ? (
                <span>发给 {message.to.join(', ')}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip color="neutral">{message.mailboxAddress}</Chip>
              <Chip color="blue">
                {message.direction === 'inbound' ? '收件' : '发件'}
              </Chip>
              {message.attachments.length > 0 ? (
                <Chip color="gray">{message.attachments.length} 个附件</Chip>
              ) : null}
            </div>
          </div>

          <Divider />

          {message.attachments.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {message.attachments.map((file) => (
                <span
                  key={file.id}
                  className="inline-flex items-center gap-2 rounded-lg border border-border-button-default px-3 py-2 text-caption-1-regular text-text-secondary"
                >
                  <RiAttachment2 className="size-4" aria-hidden />
                  {file.filename}
                  <span className="text-text-tertiary">
                    {formatBytes(file.size)}
                  </span>
                </span>
              ))}
            </div>
          ) : null}

          {message.html ? (
            <div className="overflow-hidden rounded-xl border border-separator-border">
              {!allowImages ? (
                <div className="flex items-center justify-between gap-3 border-b border-separator-border bg-background-tertiary-default px-4 py-2">
                  <span className="text-caption-1-regular text-text-secondary">
                    为保护隐私，远程图片已默认屏蔽
                  </span>
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => setAllowImages(true)}
                  >
                    显示图片
                  </Button>
                </div>
              ) : null}
              <iframe
                title="邮件正文"
                sandbox="allow-popups"
                srcDoc={srcDoc}
                className="h-[60vh] w-full bg-white"
              />
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words text-body-regular text-text-primary">
              {message.text || '（无正文）'}
            </pre>
          )}

          {message.direction === 'inbound' ? (
            <div className="pt-2">
              <Button
                variant="secondary"
                leadingIcon={RiCornerUpLeftLine}
                disabled={!fromMailbox}
                onClick={() => {
                  if (!fromMailbox) return
                  openCompose({
                    fromMailboxId: fromMailbox.id,
                    to: message.fromAddress,
                    subject: message.subject?.startsWith('Re:')
                      ? message.subject
                      : `Re: ${message.subject ?? ''}`,
                  })
                }}
              >
                回复
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export function ReaderPlaceholder() {
  return (
    <section className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background-secondary-default p-8 text-center md:flex">
      <RiMailOpenLine
        className="size-12 text-foreground-icon-quaternary"
        aria-hidden
      />
      <p className="text-body-medium text-text-secondary">选择一封邮件查看</p>
      <p className="max-w-xs text-caption-1-regular text-text-tertiary">
        左侧列表默认展示全部邮箱的邮件，你也可以在侧边栏切换到单个邮箱。
      </p>
    </section>
  )
}
