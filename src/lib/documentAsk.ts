/**
 * Plain text and search for staff questions about a quote or scope.
 * The wording is what the document says. Search is local. Asking is a separate staff-only call.
 */

export interface DocumentSection {
  heading: string
  body: string
}

export interface DocumentMatch {
  heading: string
  text: string
}

const SKIP_KEYS = new Set([
  'include_photos',
  'has_secondary',
  'completed_by',
  'check_override',
  'clauses_from_kind',
])

const LABELS: Record<string, string> = {
  title: 'Title',
  reference: 'Reference',
  client_name: 'Client',
  site_address: 'Site address',
  job_address: 'Job address',
  tip_address: 'Tip address',
  biohazard_type: 'Biohazard type',
  area_affected: 'Area affected',
  description: 'Site findings',
  presentation: 'Presentation',
  objective: 'Objective',
  scope_of_work: 'Scope of work',
  scope: 'Scope',
  scope_work: 'Scope',
  executive_summary: 'Objective',
  methodology: 'Methodology',
  safety_protocols: 'Safety and PPE',
  safety: 'Safety and PPE',
  waste_disposal: 'Waste',
  waste: 'Waste',
  timeline: 'Timeline',
  exclusions: 'Exclusions',
  inclusions: 'Inclusions',
  assumptions: 'Assumptions',
  disclaimer: 'Caveats',
  caveats: 'Caveats',
  terms: 'Payment terms',
  payment_terms: 'Payment terms',
  engagement_agreement: 'Engagement agreement',
  authority: 'Authority',
  acceptance: 'Acceptance',
  rooms: 'Rooms',
  secondary_rooms: 'Secondary zone rooms',
  extra_lines: 'Additional charges',
  other_lines: 'Other costs',
  secondary_zone: 'Secondary zone',
  secondary_contamination: 'Secondary contamination',
  secondary_objective: 'Secondary objective',
  other_zones: 'Other zones',
  mobilisation_reason: 'Mobilisation note',
  estimated_m2: 'Estimated area',
  secondary_m2: 'Secondary zone area',
  estimated_m3: 'Estimated volume',
  estimated_km: 'Estimated distance',
  travel_km: 'Travel distance',
  labour_days: 'Labour',
  gst: 'GST',
  subtotal: 'Subtotal',
  total: 'Total',
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are',
  'at', 'by', 'it', 'this', 'that', 'from', 'what', 'does', 'do', 'did', 'say', 'says',
  'said', 'about', 'document', 'quote', 'how', 'why', 'when', 'where', 'which', 'who',
  'can', 'could', 'would', 'should', 'there', 'any', 'anything', 'please', 'tell', 'me',
])

function labelFor(key: string): string {
  return LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function aud(n: number): string {
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })
}

function isMoneyKey(key: string): boolean {
  return key === 'gst' || key === 'subtotal' || key === 'total'
    || key.endsWith('_amount') || key.endsWith('_fee') || key.includes('rate')
}

export function plainFromHtml(value: string): string {
  return value
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|blockquote)\s*>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

function formatNumber(key: string, n: number): string {
  if (!Number.isFinite(n)) return ''
  if (isMoneyKey(key)) return aud(n)
  if (key.endsWith('_m2') || key === 'area_m2') return `${n} m²`
  if (key.endsWith('_m3')) return `${n} m³`
  if (key.endsWith('_km')) return `${n} km`
  if (key === 'estimated_tonnes') return `${n} t`
  if (key.endsWith('_days') || key === 'labour_days') return n === 1 ? '1 day' : `${n} days`
  return String(n)
}

function formatLeaf(key: string, value: unknown): string | null {
  if (value == null || typeof value === 'boolean') return null
  if (typeof value === 'number') {
    const formatted = formatNumber(key, value)
    return formatted || null
  }
  if (typeof value === 'string') {
    const plain = plainFromHtml(value)
    return plain || null
  }
  if (Array.isArray(value)) {
    const lines = value.map(item => formatItem(key, item)).filter((line): line is string => Boolean(line))
    return lines.length ? lines.join('\n') : null
  }
  if (typeof value === 'object') return formatRecord(value as Record<string, unknown>)
  return null
}

function formatItem(key: string, item: unknown): string | null {
  if (typeof item === 'string' || typeof item === 'number') return formatLeaf(key, item)
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  return formatRecord(item as Record<string, unknown>)
}

function formatRecord(value: Record<string, unknown>): string | null {
  if (typeof value.name === 'string' && (value.detail != null || value.area_m2 != null)) {
    const area = typeof value.area_m2 === 'number' ? `${value.area_m2} m²` : ''
    const detail = typeof value.detail === 'string' ? value.detail.trim() : ''
    const line = [value.name.trim() || 'Room', detail, area].filter(Boolean).join(' — ')
    return line || null
  }
  if (typeof value.label === 'string' && typeof value.amount === 'number') {
    const qty = value.quantity != null ? String(value.quantity) : ''
    const unit = typeof value.unit === 'string' ? value.unit : ''
    const rate = typeof value.rate === 'number' ? `at ${aud(value.rate)}` : ''
    const left = [qty, unit, rate].filter(Boolean).join(' ')
    const money = left ? `${value.label}: ${left} = ${aud(value.amount)}` : `${value.label}: ${aud(value.amount)}`
    const description = typeof value.description === 'string' ? value.description.trim() : ''
    return description ? `${money}\n${description}` : money
  }
  const lines: string[] = []
  for (const [key, child] of Object.entries(value)) {
    if (SKIP_KEYS.has(key)) continue
    const formatted = formatLeaf(key, child)
    if (!formatted) continue
    lines.push(formatted.includes('\n') ? `${labelFor(key)}\n${formatted}` : `${labelFor(key)}: ${formatted}`)
  }
  return lines.length ? lines.join('\n') : null
}

export function sectionsFromDocument(content: unknown): DocumentSection[] {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    const body = formatLeaf('document', content)
    return body ? [{ heading: 'Document', body }] : []
  }
  const sections: DocumentSection[] = []
  for (const [key, value] of Object.entries(content as Record<string, unknown>)) {
    if (SKIP_KEYS.has(key)) continue
    const body = formatLeaf(key, value)
    if (!body) continue
    sections.push({ heading: labelFor(key), body })
  }
  return sections
}

export function documentPlainText(content: unknown): string {
  return sectionsFromDocument(content)
    .map(section => `## ${section.heading}\n${section.body}`)
    .join('\n\n')
}

export function parseDocumentSections(text: string): DocumentSection[] {
  return text.split(/\n(?=## )/).flatMap(chunk => {
    const lines = chunk.split('\n')
    const marked = lines[0]?.startsWith('## ') ?? false
    const heading = marked ? lines[0].slice(3).trim() : 'Document'
    const body = (marked ? lines.slice(1) : lines).join('\n').trim()
    return body ? [{ heading: heading || 'Document', body }] : []
  })
}

export function searchTerms(query: string): string[] {
  const raw = query.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean)
  const useful = raw.filter(token => token.length >= 3 && !STOP_WORDS.has(token))
  if (useful.length) return useful
  return raw.filter(token => token.length >= 2)
}

function scoreText(text: string, terms: string[]): number {
  const haystack = text.toLowerCase()
  const phrase = terms.join(' ')
  let score = 0
  let found = 0
  if (phrase && haystack.includes(phrase)) score += 10
  for (const term of terms) {
    if (!haystack.includes(term)) continue
    found += 1
    score += 2
  }
  if (found === terms.length) score += 5
  return score
}

export function searchDocument(text: string, query: string, limit = 8): DocumentMatch[] {
  const terms = searchTerms(query)
  if (!terms.length || !text.trim()) return []
  const hits: { heading: string; text: string; score: number }[] = []
  for (const section of parseDocumentSections(text)) {
    const lines = section.body.split('\n').map(line => line.trim()).filter(Boolean)
    for (let i = 0; i < lines.length; i++) {
      const lineScore = scoreText(lines[i], terms)
      const paired = i + 1 < lines.length ? `${lines[i]} ${lines[i + 1]}` : ''
      const pairedScore = paired ? scoreText(paired, terms) : 0
      if (lineScore > 0 && lineScore >= pairedScore) {
        hits.push({ heading: section.heading, text: lines[i], score: lineScore })
      } else if (paired && pairedScore > lineScore) {
        hits.push({ heading: section.heading, text: paired, score: pairedScore })
      }
    }
  }
  hits.sort((a, b) => b.score - a.score)
  const kept: DocumentMatch[] = []
  for (const hit of hits) {
    if (kept.some(existing => existing.text.includes(hit.text) || hit.text.includes(existing.text))) continue
    kept.push({ heading: hit.heading, text: hit.text })
    if (kept.length >= limit) break
  }
  return kept
}

export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const terms = [...searchTerms(query)].sort((a, b) => b.length - a.length)
  if (!terms.length) return [{ text, hit: false }]
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'ig')
  return text.split(pattern).filter(Boolean).map(part => ({
    text: part,
    hit: terms.some(term => part.toLowerCase() === term),
  }))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
