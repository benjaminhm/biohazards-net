/**
 * TipTap stores prose as a small HTML subset. Print/PDF must sanitize before
 * embedding in branded HTML (XSS). Legacy plain-text fields stay escaped.
 */
import DOMPurify from 'isomorphic-dompurify'

const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'blockquote']

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
    return DOMPurify.sanitize(t, { ALLOWED_TAGS, ALLOWED_ATTR: [] })
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
