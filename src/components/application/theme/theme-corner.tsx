import { ThemeToggle } from './theme-toggle'

/** 认证页、重置密码页等没有侧栏的页面用它提供主题切换入口 */
export function ThemeCorner() {
  return (
    <div className="fixed end-4 top-4 z-10">
      <ThemeToggle appearance="segmented" size="small" />
    </div>
  )
}
