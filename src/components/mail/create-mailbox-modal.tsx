import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { RiAddLine, RiRefreshLine } from '@remixicon/react'

import { Button } from '#/components/base/buttons/button'
import { Input } from '#/components/base/input/input'
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '#/components/base/modal/modal'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '#/components/base/segmented-control/segmented-control'
import { Select, SelectItem } from '#/components/base/select/select'
import { toast } from '#/components/base/toast/toast'
import { Spinner } from '#/components/base/spinner/spinner'
import { createMailboxFn } from '#/server/fns/mail'
import { domainsQuery } from '#/lib/api'
import { queryKeys } from '#/lib/query-keys'
import { randomNameLocalPart } from '#/lib/name-prefix'

const rootApi = getRouteApi('__root__')

export function CreateMailboxModal({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { site } = rootApi.useLoaderData()
  const [kind, setKind] = useState<'permanent' | 'temp'>('permanent')
  const [prefix, setPrefix] = useState('')
  const [domainId, setDomainId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const tempPrefixMin = Math.max(site.tempPrefixMin, 8)
  const permanentPrefixMin = site.permanentPrefixMin
  const prefixMax = site.prefixMax

  const domains = useQuery({ ...domainsQuery(kind), enabled: isOpen })

  useEffect(() => {
    if (!isOpen) return
    setPrefix(
      kind === 'temp'
        ? randomNameLocalPart({
            minLength: tempPrefixMin,
            maxLength: prefixMax,
          })
        : '',
    )
    setDomainId(null)
  }, [kind, isOpen, tempPrefixMin, prefixMax])

  const selectedDomain = useMemo(() => {
    const list = domains.data ?? []
    return list.find((item) => item.id === domainId) ?? list.at(0)
  }, [domainId, domains.data])

  async function submit() {
    if (!prefix.trim()) {
      toast.error('请填写邮箱前缀')
      return
    }
    setSubmitting(true)
    const result = await createMailboxFn({
      data: {
        kind,
        localPart: prefix.trim(),
        domainId: selectedDomain?.id,
      },
    })
    setSubmitting(false)

    if (!result.ok) {
      toast.error(result.error.message)
      return
    }

    toast.success(`已创建 ${result.data.address}`)
    await navigator.clipboard
      .writeText(result.data.address)
      .catch(() => undefined)
    await queryClient.invalidateQueries({ queryKey: queryKeys.mailboxes })
    onOpenChange(false)
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md">
      {(renderProps) => (
        <>
          <ModalHeader
            title="新建邮箱"
            description={
              kind === 'temp'
                ? '创建后 1 小时内收到任意一封邮件，该邮箱永久保留；1 小时无收件则自动失效。数量不限。'
                : '长期邮箱可用于收发邮件，数量受管理员配额限制。'
            }
            icon={RiAddLine}
          />
          <ModalBody className="flex flex-col gap-4">
            <SegmentedControl
              selectedKeys={[kind]}
              onSelectionChange={(keys) => {
                const next = Array.from(keys)[0]
                if (next === 'permanent' || next === 'temp') setKind(next)
              }}
              aria-label="邮箱类型"
            >
              <SegmentedControlItem id="permanent">
                长期邮箱
              </SegmentedControlItem>
              <SegmentedControlItem id="temp">临时邮箱</SegmentedControlItem>
            </SegmentedControl>

            <div className="flex items-end gap-2">
              <Input
                label="前缀"
                placeholder={
                  kind === 'temp'
                    ? `至少 ${tempPrefixMin} 位`
                    : `至少 ${permanentPrefixMin} 位`
                }
                value={prefix}
                onChange={setPrefix}
                className="flex-1"
                inputDir="ltr"
                hint={
                  selectedDomain
                    ? `完整地址：${prefix || '…'}@${selectedDomain.hostname}`
                    : '还没有可用域名'
                }
              />
              {kind === 'temp' ? (
                <Button
                  variant="secondary"
                  leadingIcon={RiRefreshLine}
                  onClick={() =>
                    setPrefix(
                      randomNameLocalPart({
                        minLength: tempPrefixMin,
                        maxLength: prefixMax,
                      }),
                    )
                  }
                  className="mb-5"
                >
                  随机
                </Button>
              ) : null}
            </div>

            <Select
              label="域名"
              placeholder="选择域名"
              selectedKey={selectedDomain?.id ?? null}
              onSelectionChange={(key) => setDomainId(String(key))}
              isDisabled={!domains.data || domains.data.length === 0}
            >
              {(domains.data ?? []).map((item) => (
                <SelectItem
                  key={item.id}
                  id={item.id}
                  textValue={item.hostname}
                >
                  {item.hostname}
                </SelectItem>
              ))}
            </Select>

            {domains.isLoading ? (
              <div className="flex items-center gap-2 text-caption-1-regular text-text-tertiary">
                <Spinner className="size-4" /> 正在读取可用域名…
              </div>
            ) : null}
            {!domains.isLoading && (domains.data ?? []).length === 0 ? (
              <p className="rounded-lg bg-background-tertiary-default p-3 text-caption-1-regular text-text-secondary">
                管理员还没有配置可用域名。请先在管理后台添加域名并通过验证。
              </p>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={renderProps.close}>
              取消
            </Button>
            <Button onClick={submit} disabled={submitting || !selectedDomain}>
              {submitting ? '创建中…' : '创建邮箱'}
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  )
}
