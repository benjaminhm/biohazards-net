import type { AssessmentData, SowCapture } from '@/lib/types'

export const EMPTY_SOW_CAPTURE: SowCapture = {
  objective: '',
  scope_work: '',
  methodology: '',
  timeline: '',
  safety: '',
  waste: '',
  exclusions: '',
  caveats: '',
}

/** Merge persisted sow_capture with legacy sow_objective into objective when needed. */
export function mergedSowCapture(ad: AssessmentData | null | undefined): SowCapture {
  const c = ad?.sow_capture
  const base: SowCapture = {
    ...EMPTY_SOW_CAPTURE,
    ...(c ?? {}),
  }
  const legacy = (ad?.sow_objective ?? '').trim()
  if (!base.objective.trim() && legacy) {
    base.objective = ad!.sow_objective!
  }
  return base
}

const SOW_LABELS: [keyof SowCapture, string][] = [
  ['objective', 'Objective'],
  ['scope_work', 'Scope / work narrative'],
  ['methodology', 'Methodology'],
  ['timeline', 'Timeline'],
  ['safety', 'Safety & PPE'],
  ['waste', 'Waste'],
  ['exclusions', 'Exclusions'],
  ['caveats', 'Caveats / disclaimer'],
]

/** True if any staff SOW field has content (after legacy objective merge). */
export function staffSowHasContent(ad: AssessmentData | null | undefined): boolean {
  const m = mergedSowCapture(ad)
  return SOW_LABELS.some(([k]) => (m[k] ?? '').trim().length > 0)
}

/** Non-empty lines for JOB CONTEXT; empty string if nothing to show. */
export function staffSowCaptureBlock(ad: AssessmentData | null | undefined): string {
  const m = mergedSowCapture(ad)
  const rows: string[] = []
  for (const [k, label] of SOW_LABELS) {
    const v = (m[k] ?? '').trim()
    if (v) rows.push(`- ${label}: ${v}`)
  }
  if (rows.length === 0) return ''
  return `SCOPE OF WORK — STAFF CAPTURE (align generated SOW sections; do not contradict):\n${rows.join('\n')}`
}

const MAX_FIELD_CHARS = 6000

/** Normalize AI draft JSON to a safe SowCapture (trim, cap length, default keys). */
export function normalizeSowCaptureDraft(raw: unknown): SowCapture {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const clip = (s: string) => s.trim().slice(0, MAX_FIELD_CHARS)
  const str = (k: keyof SowCapture) => clip(typeof o[k] === 'string' ? o[k] : '')
  return {
    objective: str('objective'),
    scope_work: str('scope_work'),
    methodology: str('methodology'),
    timeline: str('timeline'),
    safety: str('safety'),
    waste: str('waste'),
    exclusions: str('exclusions'),
    caveats: str('caveats'),
  }
}
