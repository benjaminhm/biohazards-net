/**
 * Company Letterhead — a letter the staff write themselves.
 * The company header is applied when the document is generated.
 * Body HTML comes from the rich-text editor; images are uploaded separately
 * and are not job photos.
 */
import { proseHasPrintableContent } from '@/lib/richTextPrint'

export interface CompanyLetterheadImage {
  id: string
  url: string
  caption: string
}

export interface CompanyLetterheadCapture {
  body_html: string
  images: CompanyLetterheadImage[]
}

export interface CompanyLetterheadContent {
  title: string
  reference: string
  date: string
  body_html: string
  images: { url: string; caption: string }[]
}

export function emptyCompanyLetterheadCapture(): CompanyLetterheadCapture {
  return { body_html: '', images: [] }
}

function safeImageUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const url = value.trim()
  if (!/^https?:\/\//i.test(url)) return ''
  return url
}

export function normalizeCompanyLetterheadCapture(raw: unknown): CompanyLetterheadCapture {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const body = typeof source.body_html === 'string' ? source.body_html : ''
  const images = Array.isArray(source.images) ? source.images : []
  const normalized: CompanyLetterheadImage[] = []
  for (const item of images) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const url = safeImageUrl(row.url)
    if (!url) continue
    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : url
    const caption = typeof row.caption === 'string' ? row.caption.slice(0, 240) : ''
    normalized.push({ id, url, caption })
    if (normalized.length >= 12) break
  }
  return { body_html: body, images: normalized }
}

export function companyLetterheadHasContent(capture: CompanyLetterheadCapture): boolean {
  return proseHasPrintableContent(capture.body_html) || capture.images.length > 0
}
