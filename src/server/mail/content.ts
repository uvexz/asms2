import sanitizeHtml from 'sanitize-html'

/**
 * 邮件 HTML 的双保险之一（另一层是前端 sandbox iframe）。
 * 只允许邮件里常见的安全标签，去掉脚本、表单、iframe 与事件属性。
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'center', 'code', 'col',
    'colgroup', 'dd', 'div', 'dl', 'dt', 'em', 'font', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'small', 'span',
    'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
    'tr', 'u', 'ul',
  ],
  allowedAttributes: {
    '*': ['style', 'class', 'align', 'valign', 'width', 'height', 'bgcolor', 'color', 'dir', 'colspan', 'rowspan'],
    a: ['href', 'name', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'srcset'],
    font: ['color', 'face', 'size'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'cid', 'data'],
  allowedSchemesByTag: { img: ['http', 'https', 'cid', 'data'] },
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      },
    }),
  },
  disallowedTagsMode: 'discard',
}

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS)
}

export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function makeSnippet(text: string | null | undefined, limit = 160) {
  if (!text) return ''
  return text.replace(/\s+/g, ' ').trim().slice(0, limit)
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 纯文本写信：换行转段落，保留基本可读性 */
export function textToHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br />')}</p>`)
    .join('')
  return `<div>${paragraphs}</div>`
}
