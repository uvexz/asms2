import { createFileRoute } from '@tanstack/react-router'

import { MessageList } from '#/components/mail/message-list'
import { ReaderPlaceholder } from '#/components/mail/message-reader'

export const Route = createFileRoute('/mail/')({
  component: MailIndex,
})

function MailIndex() {
  return (
    <>
      <MessageList />
      <ReaderPlaceholder />
    </>
  )
}
