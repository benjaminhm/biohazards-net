import type { AssessmentData, AssessmentDocumentCapture, PathophysiologyRow } from '@/lib/types'

export const EMPTY_ASSESSMENT_DOCUMENT_CAPTURE: AssessmentDocumentCapture = {
  site_summary: '',
  hazards_overview: '',
  risks_overview: '',
  control_measures: '',
  recommendations: '',
  limitations: '',
  pathophysiology_table: [],
}

export function mergedAssessmentDocumentCapture(ad: AssessmentData | null | undefined): AssessmentDocumentCapture {
  const c = ad?.assessment_document_capture
  return {
    ...EMPTY_ASSESSMENT_DOCUMENT_CAPTURE,
    ...(c ?? {}),
    pathophysiology_table: Array.isArray(c?.pathophysiology_table) ? c.pathophysiology_table : [],
  }
}

const FIELD_LABELS: [keyof AssessmentDocumentCapture, string][] = [
  ['site_summary', 'Site summary'],
  ['hazards_overview', 'Hazards overview'],
  ['risks_overview', 'Risks overview'],
  ['control_measures', 'Control measures'],
  ['recommendations', 'Recommendations'],
  ['limitations', 'Limitations'],
]

/** True if any assessment document field has content. */
export function assessmentDocumentHasContent(ad: AssessmentData | null | undefined): boolean {
  const m = mergedAssessmentDocumentCapture(ad)
  const textHas = FIELD_LABELS.some(([k]) => {
    const v = m[k]
    return typeof v === 'string' && v.trim().length > 0
  })
  const tableHas = (m.pathophysiology_table ?? []).some(r => (r.disease || '').trim().length > 0)
  return textHas || tableHas
}

/** Non-empty lines for JOB CONTEXT; empty string if nothing to show. */
export function staffAssessmentDocumentBlock(ad: AssessmentData | null | undefined): string {
  const m = mergedAssessmentDocumentCapture(ad)
  const rows: string[] = []
  for (const [k, label] of FIELD_LABELS) {
    const v = m[k]
    if (typeof v === 'string' && v.trim()) rows.push(`- ${label}: ${v.trim()}`)
  }
  const table = m.pathophysiology_table ?? []
  if (table.length > 0) {
    const tableLines = table
      .filter(r => (r.disease || '').trim())
      .map(r => `  · ${r.disease.trim()}${r.pathogen ? ` (${r.pathogen.trim()})` : ''}`)
    if (tableLines.length > 0) {
      rows.push(`- Pathophysiology table (${tableLines.length} ${tableLines.length === 1 ? 'row' : 'rows'}):`)
      rows.push(...tableLines)
    }
  }
  if (rows.length === 0) return ''
  return `ASSESSMENT DOCUMENT — STAFF CAPTURE:\n${rows.join('\n')}`
}

const MAX_FIELD_CHARS = 6000
const MAX_PATHOPHYS_ROWS = 30
const MAX_CELL_CHARS = 800

function clipCell(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, MAX_CELL_CHARS) : ''
}

export function normalizePathophysiologyTable(raw: unknown): PathophysiologyRow[] {
  if (!Array.isArray(raw)) return []
  const out: PathophysiologyRow[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const row = r as Record<string, unknown>
    const disease = clipCell(row.disease)
    if (!disease) continue
    out.push({
      disease,
      pathogen: clipCell(row.pathogen) || undefined,
      transmission: clipCell(row.transmission) || undefined,
      effects: clipCell(row.effects) || undefined,
      incubation: clipCell(row.incubation) || undefined,
      ppe: clipCell(row.ppe) || undefined,
    })
    if (out.length >= MAX_PATHOPHYS_ROWS) break
  }
  return out
}

/** Normalize AI draft JSON to a safe AssessmentDocumentCapture. */
export function normalizeAssessmentDocumentDraft(raw: unknown): AssessmentDocumentCapture {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const clip = (s: string) => s.trim().slice(0, MAX_FIELD_CHARS)
  const str = (k: keyof AssessmentDocumentCapture) => clip(typeof o[k] === 'string' ? (o[k] as string) : '')
  return {
    site_summary: str('site_summary'),
    hazards_overview: str('hazards_overview'),
    risks_overview: str('risks_overview'),
    control_measures: str('control_measures'),
    recommendations: str('recommendations'),
    limitations: str('limitations'),
    pathophysiology_table: normalizePathophysiologyTable(o.pathophysiology_table),
  }
}
