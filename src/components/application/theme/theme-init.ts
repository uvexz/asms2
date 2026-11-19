/** 与 ThemeToggle 共用的 localStorage 键 */
export const THEME_STORAGE_KEY = 'boardui:theme'

/**
 * 在 hydration 之前把主题类打到 <html> 上。
 * 之前主题只在 ThemeToggle 挂载后应用，登录/注册/管理页没渲染这个控件，
 * 直接打开时已存的暗色不会生效，暗色用户还会先看到一帧白屏。
 */
export const THEME_INIT_SCRIPT = [
  '(function(){try{',
  `var key=${JSON.stringify(THEME_STORAGE_KEY)};`,
  'var stored=localStorage.getItem(key);',
  "var dark=stored==='dark'||(stored===null&&window.matchMedia('(prefers-color-scheme: dark)').matches);",
  "document.documentElement.classList.toggle('dark',dark);",
  '}catch(e){}})();',
].join('')
