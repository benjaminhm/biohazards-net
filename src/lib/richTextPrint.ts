/**
 * TipTap stores prose as a small HTML subset. Print/PDF must sanitize before
 * embedding in branded HTML (XSS). Legacy plain-text fields stay escaped.
 */
import sanitizeHtml from 'sanitize-html'

const ALLOWED_TAGS = ['p', 'span', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'blockquote']
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
    // Parser-based allowlist sanitiser (htmlparser2). Keeps only formatting tags
    // and the `style` attribute; `sanitizeAllowedStyles` then narrows styles to
    // the handful of declarations we intentionally support in print. No jsdom.
    const cleaned = sanitizeHtml(t, {
      allowedTags: ALLOWED_TAGS,
      allowedAttributes: { '*': ['style'] },
      // Drop disallowed tags but keep their text (matches prior behaviour).
      disallowedTagsMode: 'discard',
    })
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

/**
 * HTML / TipTap prose → plain multi-line text. For surfaces that can't render
 * HTML (react-pdf `<Text>`, plain-text accept page, email previews). Block-level
 * tags become newlines; inline tags are dropped; common HTML entities are
 * decoded. Plain-text input passes through unchanged.
 */
export function proseToPlainText(raw: string | undefined | null): string {
  const s = String(raw ?? '')
  if (!s.trim()) return ''
  if (!looksLikeHtml(s)) return s
  const withNewlines = s
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|blockquote)\s*>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '\n• ')
  const stripped = withNewlines.replace(/<[^>]+>/g, '')
  const decoded = stripped
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return decoded.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim()
}
