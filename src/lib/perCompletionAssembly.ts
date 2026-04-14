/**
 * Assembles completion report narrative from execute-phase sources (PER) + planned SOW summary.
 * Staff-authored completion_report_capture overrides any assembled field when non-empty.
 */
import type {
  AssessmentData,
  CompletionReportCapture,
  Job,
  PerExecuteCapture,
  Photo,
  ProgressNote,
  ProgressRoomNote,
} from '@/lib/types'
import { mergedSowCapture } from '@/lib/sowCapture'
import { mergedPerExecuteCapture } from '@/lib/perExecuteCapture'

export interface CompletionReportComposeContext {
  photos: Photo[]
  progressNotes: ProgressNote[]
  progressRoomNotes: ProgressRoomNote[]
}

const MAX_SOW_SNIPPET = 4000

export function isProgressEvidencePhoto(p: Photo): boolean {
  if (p.capture_phase === 'progress') return true
  if (p.capture_phase === 'assessment') return false
  return p.category === 'during' || p.category === 'after'
}

function clip(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max).trim()}…`
}

/** Planned scope summary only (SOW) — for executive_summary assembly and planned-vs-actual contrast. */
export function formatSowPlannedSummary(ad: AssessmentData | null | undefined): string {
  const sow = mergedSowCapture(ad)
  const parts: string[] = []
  const obj = sow.objective.trim()
  const scope = sow.scope_work.trim()
  const timeline = sow.timeline.trim()
  if (obj) parts.push(`Objective\n${obj}`)
  if (scope) parts.push(`Key scope\n${clip(scope, MAX_SOW_SNIPPET)}`)
  if (timeline) parts.push(`Timeline (planned)\n${timeline}`)
  if (parts.length === 0) return ''
  return parts.join('\n\n')
}

export function formatProgressPhotosForReport(photos: Photo[]): string {
  const list = photos.filter(isProgressEvidencePhoto)
  if (list.length === 0) return ''
  const lines = list.map((p, i) => {
    const area = (p.area_ref || '').trim() || '—'
    const cap = (p.caption || '').trim() || '—'
    const phase = p.capture_phase === 'progress' ? 'progress' : p.capture_phase ?? '—'
    return `${i + 1}. ${p.category} | ${phase} | ${area}\n   ${cap}`
  })
  return `Progress photo record (${list.length})\n\n${lines.join('\n\n')}`
}

function activeProgressNotes(notes: ProgressNote[]): ProgressNote[] {
  return notes.filter(n => !n.deleted_at && !n.archived_at)
}

export function formatProgressNotesForReport(notes: ProgressNote[]): string {
  const list = activeProgressNotes(notes)
  if (list.length === 0) return ''
  const lines = list.map((n, i) => {
    const room = (n.room || '').trim() || 'General'
    const body = (n.body || '').trim() || '—'
    return `${i + 1}. ${room}\n${body}`
  })
  return `Progress notes\n\n${lines.join('\n\n')}`
}

export function formatProgressRoomNotesForReport(notes: ProgressRoomNote[]): string {
  if (notes.length === 0) return ''
  const lines = notes.map((n, i) => {
    const room = (n.room_name || '').trim() || '—'
    const body = (n.note || '').trim() || '—'
    return `${i + 1}. ${room}\n${body}`
  })
  return `Room notes (progress photos)\n\n${lines.join('\n\n')}`
}

function formatOutcomeFromPer(per: PerExecuteCapture): string {
  const rec = per.recommendations.trim()
  const qc = per.quality_checks.trim()
  const parts: string[] = []
  if (rec) parts.push(`Recommendations\n${rec}`)
  if (qc) parts.push(`Quality control checks\n${qc}`)
  return parts.join('\n\n')
}

/**
 * Raw assembly from PER + SOW (no staff completion_report_capture).
 */
export function assembleCompletionReportFromSources(
  job: Job,
  ctx: CompletionReportComposeContext,
): CompletionReportCapture {
  const ad = job.assessment_data
  const per = mergedPerExecuteCapture(ad)
  const sowPlanned = formatSowPlannedSummary(ad)
  const notesBlock = [formatProgressNotesForReport(ctx.progressNotes), formatProgressRoomNotesForReport(ctx.progressRoomNotes)]
    .filter(Boolean)
    .join('\n\n')
  const photosBlock = formatProgressPhotosForReport(ctx.photos)
  const methodology = mergedSowCapture(ad).methodology.trim()

  return {
    executive_summary: sowPlanned,
    site_conditions: '',
    works_carried_out: notesBlock,
    methodology: methodology ? `Planned methodology (Scope of Work)\n${methodology}` : '',
    products_used: '',
    waste_disposal: per.waste_manifest_notes.trim(),
    photo_record: photosBlock,
    outcome: formatOutcomeFromPer(per),
    technician_signoff: '',
  }
}

/** Merge: non-empty staff completion_report_capture wins; else assembled from PER + SOW. */
export function mergeStaffCompletionWithAssembly(
  staff: CompletionReportCapture,
  assembled: CompletionReportCapture,
): CompletionReportCapture {
  const out: CompletionReportCapture = { ...assembled }
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
  for (const k of keys) {
    if (String(staff[k] ?? '').trim()) out[k] = staff[k]
  }
  return out
}
