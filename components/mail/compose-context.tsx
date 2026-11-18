import { createContext, useContext } from 'react'

export interface ComposeOptions {
  fromMailboxId?: string
  to?: string
  subject?: string
}

export const ComposeContext = createContext<{
  openCompose: (options?: ComposeOptions) => void
}>({
  openCompose: () => undefined,
})

export function useCompose() {
  return useContext(ComposeContext)
}
