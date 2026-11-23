import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import {
  RiArchiveLine,
  RiArrowLeftLine,
  RiAttachment2,
  RiCornerUpLeftLine,
  RiDeleteBinLine,
  RiInboxLine,
  RiMailOpenLine,
  RiMailUnreadLine,
  RiSpam2Line,
  RiStarFill,
  RiStarLine,
} from '@remixicon/react'

import { Button } from '#/components/base/buttons/button'
import { IconButton } from '#/components/base/buttons/icon-button'
import { Chip } from '#/components/base/badges/chip'
import { Divider } from '#/components/base/divider/divider'
import { Spinner } from '#/components/base/spinner/spinner'
import { toast } from '#/components/base/toast/toast'
import {
  formatBytes,
  formatDateTime,
  messageQuery,
  noteMessageWrite,
  patchMessageCaches,
  removeMessageFromCaches,
  setMailboxUnread,
  unwrap,
} from '#/lib/api'
import { updateMessageFn } from '#/server/fns/mail'
import type { MailboxView } from '#/server/mail/mailbox'
import { ErrorState } from '#/components/application/errors/error-state'
import {
  ScrollFade,
  useScrollFade,
} from '#/components/foundations/scroll-fade/scroll-fade'

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

const rootApi = getRouteApi('__root__')

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
  const { site } = rootApi.useLoaderData()
  const [allowImages, setAllowImages] = useState(false)
  const { progress, onScroll, reset } = useScrollFade()
  const markUnreadId = useRef<string | null>(null)
  const autoReadId = useRef<string | null>(null)

  useEffect(() => {
    // 换邮件必须重置：上一封放行过的远程图片不能延续到下一封（隐私）
    setAllowImages(false)
    markUnreadId.current = null
    autoReadId.current = null
    reset()
  }, [messageId, reset])

  const query = useQuery(messageQuery(messageId))

  const message = query.data

  const {
    mutate: runUpdate,
    mutateAsync: runUpdateAsync,
    isPending: updating,
  } = useMutation({
    mutationFn: async (input: {
      id: string
      isRead?: boolean
      isStarred?: boolean
      folder?: 'inbox' | 'sent' | 'trash' | 'spam' | 'archive'
    }) => unwrap(await updateMessageFn({ data: input })),
    onMutate: (input) => {
      noteMessageWrite(input.id)
      if (typeof input.isRead === 'boolean') {
        patchMessageCaches(queryClient, input.id, { isRead: input.isRead })
      }
      if (typeof input.isStarred === 'boolean') {
        patchMessageCaches(queryClient, input.id, {
          isStarred: input.isStarred,
        })
      }
    },
    onError: (error: Error, input) => {
      patchMessageCaches(queryClient, input.id, {
        ...(typeof input.isRead === 'boolean' ? { isRead: !input.isRead } : {}),
        ...(typeof input.isStarred === 'boolean'
          ? { isStarred: !input.isStarred }
          : {}),
      })
      toast.error(error.message)
    },
    onSuccess: (data) => {
      // 服务端算的是该邮箱的绝对未读数：连点、重试、跨端都不会把计数越加越多
      if (data.unreadCount !== null) {
        setMailboxUnread(queryClient, data.mailboxId, data.unreadCount)
      }
    },
  })

  useEffect(() => {
    if (!message || message.isRead) return
    if (autoReadId.current === message.id) return
    if (markUnreadId.current === message.id) return
    // 打开即已读；失败由 onError 回滚，不在同一个 id 上反复重试
    autoReadId.current = message.id
    runUpdate({ id: message.id, isRead: true })
  }, [message, runUpdate])

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

  if (query.isError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <ErrorState
          error={query.error}
          title="邮件加载失败"
          onRetry={() => void query.refetch()}
        />
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
  const canReply = Boolean(
    fromMailbox && (fromMailbox.kind === 'permanent' || site.allowTempSend),
  )

  async function act(
    action: 'trash' | 'unread' | 'star' | 'archive' | 'spam' | 'inbox',
  ) {
    if (!message || updating) return

    try {
      if (action === 'trash') {
        await runUpdateAsync({ id: message.id, folder: 'trash' })
        removeMessageFromCaches(queryClient, message.id)
        toast.success('已移入回收站')
        void navigate({ to: '/mail', search: (prev) => ({ ...prev }) })
        return
      }

      if (action === 'unread') {
        markUnreadId.current = message.id
        await runUpdateAsync({ id: message.id, isRead: false })
        return
      }

      if (action === 'archive' || action === 'spam' || action === 'inbox') {
        await runUpdateAsync({ id: message.id, folder: action })
        removeMessageFromCaches(queryClient, message.id)
        toast.success(
          action === 'archive'
            ? '已移入归档'
            : action === 'spam'
              ? '已标记为垃圾邮件'
              : '已移回收件箱',
        )
        if (action === 'inbox') {
          void navigate({
            to: '/mail',
            search: (prev) => ({ ...prev, folder: 'inbox' }),
          })
        }
        return
      }

      await runUpdateAsync({ id: message.id, isStarred: !message.isStarred })
    } catch {
      // onError 已经回滚缓存并提示
    }
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
        {/* 发件箱里的邮件没有「回复」语义：回复会把自己变成收件人 */}
        {message.direction === 'inbound' ? (
          <IconButton
            size="small"
            icon={RiCornerUpLeftLine}
            aria-label="回复"
            disabled={!canReply}
            onClick={() => {
              if (!canReply || !fromMailbox) return
              openCompose({
                fromMailboxId: fromMailbox.id,
                to: message.fromAddress,
                subject: message.subject?.startsWith('Re:')
                  ? message.subject
                  : `Re: ${message.subject ?? ''}`,
              })
            }}
          />
        ) : null}
        <IconButton
          size="small"
          icon={message.isStarred ? RiStarFill : RiStarLine}
          aria-label={message.isStarred ? '取消星标' : '加星标'}
          disabled={updating}
          onClick={() => void act('star')}
        />
        <IconButton
          size="small"
          icon={message.folder === 'archive' ? RiInboxLine : RiArchiveLine}
          aria-label={message.folder === 'archive' ? '移回收件箱' : '移入归档'}
          disabled={updating}
          onClick={() =>
            void act(message.folder === 'archive' ? 'inbox' : 'archive')
          }
        />
        <IconButton
          size="small"
          icon={message.folder === 'spam' ? RiInboxLine : RiSpam2Line}
          aria-label={message.folder === 'spam' ? '移回收件箱' : '标记垃圾邮件'}
          disabled={updating}
          onClick={() => void act(message.folder === 'spam' ? 'inbox' : 'spam')}
        />
        <IconButton
          size="small"
          icon={RiMailUnreadLine}
          aria-label="标记未读"
          disabled={updating}
          onClick={() => void act('unread')}
        />
        <IconButton
          size="small"
          icon={RiDeleteBinLine}
          aria-label="移入回收站"
          disabled={updating}
          onClick={() => void act('trash')}
        />
        <div className="flex-1" />
        <span className="hidden text-caption-1-regular text-text-tertiary md:block">
          {formatDateTime(message.receivedAt)}
        </span>
      </header>

      <div className="relative min-h-0 flex-1">
        <div onScroll={onScroll} className="h-full overflow-y-auto">
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
                  disabled={!canReply}
                  onClick={() => {
                    if (!canReply || !fromMailbox) return
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
        <ScrollFade progress={progress} />
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
