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
