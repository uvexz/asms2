import { createFileRoute } from '@tanstack/react-router'
import { useInfiniteQuery } from '@tanstack/react-query'

import { MessageList } from '#/components/mail/message-list'
import { MessageReader } from '#/components/mail/message-reader'
import { mailboxesInfiniteQuery } from '#/lib/api'

export const Route = createFileRoute('/mail/$messageId')({
  component: MessageDetail,
})

function MessageDetail() {
  const { messageId } = Route.useParams()
  // 复用 loader 预取的 mailboxesInfiniteQuery 缓存，不再发起多余的 mailboxesQuery RPC
  const mailboxQuery = useInfiniteQuery(mailboxesInfiniteQuery())
  const mailboxes = mailboxQuery.data?.pages.flat() ?? []

  return (
    <>
      <MessageList selectedId={messageId} />
      <MessageReader messageId={messageId} mailboxes={mailboxes} />
    </>
  )
}
