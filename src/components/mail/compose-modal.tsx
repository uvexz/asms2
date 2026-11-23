import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RiSendPlaneLine } from '@remixicon/react'

import { Button } from '#/components/base/buttons/button'
import { Input } from '#/components/base/input/input'
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '#/components/base/modal/modal'
import { Select, SelectItem } from '#/components/base/select/select'
import { Textarea } from '#/components/base/textarea/textarea'
import { toast } from '#/components/base/toast/toast'
import { quotaQuery } from '#/lib/api'
import { queryKeys } from '#/lib/query-keys'
import type { MailboxView } from '#/server/mail/mailbox'
import { sendMailFn } from '#/server/fns/mail'

import { requestMailRefresh } from './refresh-bus'

export function ComposeModal({
  isOpen,
  onOpenChange,
  mailboxes,
  defaultFromId,
  defaultTo,
  defaultSubject,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  mailboxes: MailboxView[]
  defaultFromId?: string
  defaultTo?: string
  defaultSubject?: string
}) {
  const queryClient = useQueryClient()
  const quota = useQuery({ ...quotaQuery, enabled: isOpen })

  const sendable = useMemo(
    () =>
      mailboxes.filter(
        (item) => item.kind === 'permanent' && item.status === 'active',
      ),
    [mailboxes],
  )

  const [fromId, setFromId] = useState<string | null>(null)
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  // 每次打开写信是一个新请求；网络中断/结果未知时保留此键重试。
  const [draftKey, setDraftKey] = useState(() => crypto.randomUUID())

  useEffect(() => {
    if (!isOpen) return
    setFromId(defaultFromId ?? sendable.at(0)?.id ?? null)
    setTo(defaultTo ?? '')
    setSubject(defaultSubject ?? '')
    setText('')
    setCc('')
    setShowCc(false)
    setDraftKey(crypto.randomUUID())
    // 只在打开时初始化，避免后台刷新把正在编辑的内容重置
  }, [isOpen, defaultFromId, defaultTo, defaultSubject])

  async function submit() {
    if (sending) return
    if (!fromId) {
      toast.error('请选择发件邮箱')
      return
    }
    if (!to.trim()) {
      toast.error('请填写收件人')
      return
    }
    if (!text.trim()) {
      toast.error('邮件内容不能为空')
      return
    }

    setSending(true)
    try {
      const result = await sendMailFn({
        data: {
          fromMailboxId: fromId,
          to: to
            .split(/[,;\s]+/)
            .map((item) => item.trim())
            .filter(Boolean),
          cc: cc
            .split(/[,;\s]+/)
            .map((item) => item.trim())
            .filter(Boolean),
          subject: subject.trim() || undefined,
          text,
          idempotencyKey: draftKey,
        },
      })
      if (!result.ok) {
        toast.error(result.error.message)
        // 结果未知时保留原幂等键；明确失败后才换新键，避免重复邮件。
        if (result.error.code !== 'send_uncertain') {
          setDraftKey(crypto.randomUUID())
        }
        return
      }

      toast.success('邮件已发送')
      // 只刷新列表首页与配额；不再把无限列表的全部分页重取一遍
      void queryClient.invalidateQueries({ queryKey: queryKeys.quota })
      requestMailRefresh()
      onOpenChange(false)
    } catch {
      toast.error('发送邮件失败，请检查网络后重试')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      overlayClassName="items-start pt-[8vh]"
    >
      {(renderProps) => (
        <>
          <ModalHeader
            title="写信"
            description={
              quota.data
                ? `今日还可发送 ${quota.data.remaining}/${quota.data.limit} 封`
                : '正在读取额度…'
            }
            icon={RiSendPlaneLine}
          />
          <ModalBody className="flex flex-col gap-3">
            <Select
              label="发件邮箱"
              placeholder="选择发件邮箱"
              selectedKey={fromId}
              onSelectionChange={(key) => setFromId(String(key))}
              isDisabled={sendable.length === 0}
            >
              {sendable.map((item) => (
                <SelectItem key={item.id} id={item.id} textValue={item.address}>
                  {item.address}
                </SelectItem>
              ))}
            </Select>

            {sendable.length === 0 ? (
              <p className="rounded-lg bg-background-tertiary-default p-3 text-caption-1-regular text-text-secondary">
                还没有可用于发信的长期邮箱，请先创建一个。
              </p>
            ) : null}

            <Input
              label="收件人"
              placeholder="name@example.com，多个用逗号分隔"
              value={to}
              onChange={setTo}
              inputDir="ltr"
              autoCorrect="off"
              spellCheck="false"
              isRequired
            />

            {showCc ? (
              <Input
                label="抄送"
                placeholder="可选"
                value={cc}
                onChange={setCc}
                inputDir="ltr"
                autoCorrect="off"
                spellCheck="false"
              />
            ) : (
              <button
                type="button"
                className="w-fit text-caption-1-medium text-accent-700 hover:underline"
                onClick={() => setShowCc(true)}
              >
                + 添加抄送
              </button>
            )}

            <Input
              label="主题"
              placeholder="邮件主题"
              value={subject}
              onChange={setSubject}
            />

            <Textarea
              label="正文"
              placeholder="用纯文本撰写，换行会自动转换"
              value={text}
              onChange={setText}
              rows={8}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={renderProps.close}>
              取消
            </Button>
            <Button
              leadingIcon={RiSendPlaneLine}
              onClick={submit}
              disabled={sending || sendable.length === 0}
            >
              {sending ? '发送中…' : '发送'}
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  )
}
