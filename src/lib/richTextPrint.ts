/**
 * TipTap stores prose as a small HTML subset. Print/PDF must sanitize before
 * embedding in branded HTML (XSS). Legacy plain-text fields stay escaped.
 */
import DOMPurify from 'isomorphic-dompurify'

const ALLOWED_TAGS = ['p', 'span', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'blockquote']
const ALLOWED_ATTR = ['style']
const ALLOWED_ALIGN = new Set(['left', 'center', 'right'])

/** Keep only print-safe style declarations that we intentionally support in the editor. */
function sanitizeProseStyle(raw: string): string {
  const out: string[] = []
  for (const part of raw.split(';')) {
    const [propRaw, valueRaw] = part.split(':')
    if (!propRaw || !valueRaw) continue
    const prop = propRaw.trim().toLowerCase()
    const value = valueRaw.trim().toLowerCase()
    if (prop === 'text-align' && ALLOWED_ALIGN.has(value)) {
      out.push(`text-align:${value}`)
      continue
    }
    if (prop === 'font-size' && /^\d+(?:\.\d+)?(px|pt)$/.test(value)) {
      out.push(`font-size:${value}`)
    }
  }
  return out.join(';')
}

function sanitizeAllowedStyles(html: string): string {
  return html.replace(/\sstyle="([^"]*)"/gi, (_m, styleRaw: string) => {
    const cleaned = sanitizeProseStyle(styleRaw)
    return cleaned ? ` style="${escPlain(cleaned)}"` : ''
  })
}

function escPlain(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Heuristic: stored value looks like HTML from TipTap / rich editor. */
function looksLikeHtml(t: string): boolean {
  return /<[a-z][\s\S]*>/i.test(t.trim())
}

/**
 * Plain text or HTML → safe HTML for print iframe. Plain text keeps legacy
 * behaviour (escaped; newlines → &lt;br&gt;).
 */
export function richBodyHtmlForPrint(raw: string | undefined | null): string {
  const t = raw ?? ''
  if (!t.trim()) return ''
  if (looksLikeHtml(t)) {
    const cleaned = DOMPurify.sanitize(t, { ALLOWED_TAGS, ALLOWED_ATTR })
    return sanitizeAllowedStyles(cleaned)
  }
  return escPlain(t).replace(/\r\n/g, '\n').replace(/\n/g, '<br>')
}

/**
 * DB/plain string → HTML TipTap can parse. Plain text becomes &lt;p&gt; blocks.
 */
export function proseToTipTapHtml(value: string): string {
  if (!value?.trim()) return '<p></p>'
  if (looksLikeHtml(value)) return value
  const escaped = escPlain(value)
  return `<p>${escaped.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
}

/** True when stored value has visible body text after print sanitization (excludes empty TipTap `<p></p>`). */
export function proseHasPrintableContent(raw: string | undefined | null): boolean {
  const html = richBodyHtmlForPrint(raw)
  const text = html.replace(/<[^>]+>/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > 0
}
