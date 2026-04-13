import type { AssessmentData, AssessmentDocumentCapture } from '@/lib/types'

export const EMPTY_ASSESSMENT_DOCUMENT_CAPTURE: AssessmentDocumentCapture = {
  site_summary: '',
  hazards_overview: '',
  risks_overview: '',
  control_measures: '',
  recommendations: '',
  limitations: '',
}

export function mergedAssessmentDocumentCapture(ad: AssessmentData | null | undefined): AssessmentDocumentCapture {
  const c = ad?.assessment_document_capture
  return {
    ...EMPTY_ASSESSMENT_DOCUMENT_CAPTURE,
    ...(c ?? {}),
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
  return FIELD_LABELS.some(([k]) => (m[k] ?? '').trim().length > 0)
}

/** Non-empty lines for JOB CONTEXT; empty string if nothing to show. */
export function staffAssessmentDocumentBlock(ad: AssessmentData | null | undefined): string {
  const m = mergedAssessmentDocumentCapture(ad)
  const rows: string[] = []
  for (const [k, label] of FIELD_LABELS) {
    const v = (m[k] ?? '').trim()
    if (v) rows.push(`- ${label}: ${v}`)
  }
  if (rows.length === 0) return ''
  return `ASSESSMENT DOCUMENT — STAFF CAPTURE:\n${rows.join('\n')}`
}

const MAX_FIELD_CHARS = 6000

/** Normalize AI draft JSON to a safe AssessmentDocumentCapture. */
export function normalizeAssessmentDocumentDraft(raw: unknown): AssessmentDocumentCapture {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const clip = (s: string) => s.trim().slice(0, MAX_FIELD_CHARS)
  const str = (k: keyof AssessmentDocumentCapture) => clip(typeof o[k] === 'string' ? o[k] : '')
  return {
    site_summary: str('site_summary'),
    hazards_overview: str('hazards_overview'),
    risks_overview: str('risks_overview'),
    control_measures: str('control_measures'),
    recommendations: str('recommendations'),
    limitations: str('limitations'),
  }
}
