/** 手动刷新 / 发信后只刷新列表首页，不触发无限列表的全部分页重取 */
type Listener = () => void

const listeners = new Set<Listener>()

export function subscribeMailRefresh(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function requestMailRefresh() {
  for (const listener of listeners) listener()
}
