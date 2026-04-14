import type { AssessmentData, PerExecuteCapture } from '@/lib/types'

export function emptyPerExecuteCapture(): PerExecuteCapture {
  return {
    recommendations: '',
    quality_checks: '',
    waste_manifest_notes: '',
  }
}

export function mergedPerExecuteCapture(ad: AssessmentData | null | undefined): PerExecuteCapture {
  return { ...emptyPerExecuteCapture(), ...(ad?.per_execute_capture ?? {}) }
}

export function perExecuteCaptureHasContent(c: PerExecuteCapture): boolean {
  return Object.values(c).some(v => String(v ?? '').trim().length > 0)
}

export function perExecuteCaptureEqual(a: PerExecuteCapture, b: PerExecuteCapture): boolean {
  return (
    (a.recommendations ?? '') === (b.recommendations ?? '') &&
    (a.quality_checks ?? '') === (b.quality_checks ?? '') &&
    (a.waste_manifest_notes ?? '') === (b.waste_manifest_notes ?? '')
  )
}

const MAX_FIELD_CHARS = 6000

/** Normalize AI draft JSON to a safe PerExecuteCapture (trim, cap length, default keys). */
export function normalizePerExecuteCaptureDraft(raw: unknown): PerExecuteCapture {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const clip = (s: string) => s.trim().slice(0, MAX_FIELD_CHARS)
  const str = (k: keyof PerExecuteCapture) => clip(typeof o[k] === 'string' ? (o[k] as string) : '')
  return {
    recommendations: str('recommendations'),
    quality_checks: str('quality_checks'),
    waste_manifest_notes: str('waste_manifest_notes'),
  }
}
