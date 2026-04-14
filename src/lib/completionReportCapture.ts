import type { AssessmentData, CompletionReportCapture } from '@/lib/types'

export function emptyCompletionReportCapture(): CompletionReportCapture {
  return {
    executive_summary: '',
    site_conditions: '',
    works_carried_out: '',
    methodology: '',
    products_used: '',
    waste_disposal: '',
    photo_record: '',
    outcome: '',
    technician_signoff: '',
  }
}

export function mergedCompletionReportCapture(ad: AssessmentData | null | undefined): CompletionReportCapture {
  return { ...emptyCompletionReportCapture(), ...(ad?.completion_report_capture ?? {}) }
}

export function completionReportCaptureHasContent(c: CompletionReportCapture): boolean {
  return Object.values(c).some(v => String(v ?? '').trim().length > 0)
}

const MAX_COMPLETION_FIELD_CHARS = 8000

/** Normalize AI draft JSON to a safe CompletionReportCapture (trim, cap length, default keys). */
export function normalizeCompletionReportCaptureDraft(raw: unknown): CompletionReportCapture {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const clip = (s: string) => s.trim().slice(0, MAX_COMPLETION_FIELD_CHARS)
  const keys: (keyof CompletionReportCapture)[] = [
    'executive_summary',
    'site_conditions',
    'works_carried_out',
    'methodology',
    'products_used',
    'waste_disposal',
    'photo_record',
    'outcome',
    'technician_signoff',
  ]
  const out = emptyCompletionReportCapture()
  for (const k of keys) {
    out[k] = clip(typeof o[k] === 'string' ? (o[k] as string) : '')
  }
  return out
}
