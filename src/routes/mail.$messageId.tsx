import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { MessageList } from '@/components/mail/message-list'
import { MessageReader } from '@/components/mail/message-reader'
import { mailboxesQuery } from '#/lib/api'

export const Route = createFileRoute('/mail/$messageId')({
  component: MessageDetail,
})

function MessageDetail() {
  const { messageId } = Route.useParams()
  const mailboxes = useQuery(mailboxesQuery)

  return (
    <>
      <MessageList selectedId={messageId} />
      <MessageReader
        messageId={messageId}
        mailboxes={mailboxes.data ?? []}
      />
    </>
  )
}
