import type { SupabaseClient } from '@supabase/supabase-js'
import type { Area } from '@/lib/types'
import { shouldRetryPhotoInsertWithoutCapturePhase } from '@/lib/photoRowInsert'

/** When DB has no capture_phase column (migration 027), infer from category — same rule as 027 backfill. */
export function inferCapturePhaseFromCategory(category: string): 'assessment' | 'progress' {
  return category === 'during' || category === 'after' ? 'progress' : 'assessment'
}

/**
 * Job photos for case-study suggest: tolerates missing capture_phase column.
 */
export async function fetchPhotosForCaseStudySuggest(supabase: SupabaseClient, jobId: string) {
  const r1 = await supabase
    .from('photos')
    .select('area_ref, category, caption, capture_phase, uploaded_at')
    .eq('job_id', jobId)
    .order('uploaded_at', { ascending: false })
    .limit(200)
  if (r1.error && shouldRetryPhotoInsertWithoutCapturePhase(r1.error)) {
    return await supabase
      .from('photos')
      .select('area_ref, category, caption, uploaded_at')
      .eq('job_id', jobId)
      .order('uploaded_at', { ascending: false })
      .limit(200)
  }
  return r1
}

/**
 * Job photos for completion / per-execute capture: tolerates missing capture_phase column.
 */
export async function fetchPhotosForEvidenceSuggest(supabase: SupabaseClient, jobId: string) {
  const r1 = await supabase
    .from('photos')
    .select('id, area_ref, category, caption, capture_phase')
    .eq('job_id', jobId)
  if (r1.error && shouldRetryPhotoInsertWithoutCapturePhase(r1.error)) {
    return await supabase.from('photos').select('id, area_ref, category, caption').eq('job_id', jobId)
  }
  return r1
}

type EvidencePhoto = { id: string; area_ref?: string | null; category: string; capture_phase?: string | null }

/**
 * Progress evidence for the suggest routes. Photos staff chose come first: each
 * room's during and after lists, then any document's own ids (extraIds). A room
 * that has not chosen a stage keeps the old rule for it (progress-phase photos in
 * that room). Untagged photos count only when chosen.
 */
export function progressEvidencePhotos<P extends EvidencePhoto>(photos: P[], areas: Area[] = [], extraIds: string[] = []): P[] {
  const byId = new Map(photos.map(p => [p.id, p]))
  const overridden = new Set<string>()
  const chosenIds: string[] = []
  for (const area of areas) {
    const room = (area.name || '').trim()
    for (const [ids, stage] of [[area.during_photo_ids, 'during'], [area.after_photo_ids, 'after']] as const) {
      if (!Array.isArray(ids)) continue
      overridden.add(`${room}\u0000${stage}`)
      chosenIds.push(...ids)
    }
  }
  chosenIds.push(...extraIds)
  const chosen = [...new Set(chosenIds)].flatMap(id => byId.get(id) ?? [])
  const taken = new Set(chosen.map(p => p.id))
  const rest = photos.filter(p => {
    if (taken.has(p.id) || p.category === 'untagged') return false
    const progress = p.capture_phase === 'progress'
      || (p.capture_phase !== 'assessment' && (p.category === 'during' || p.category === 'after'))
    if (!progress) return false
    return !overridden.has(`${(p.area_ref || '').trim()}\u0000${p.category}`)
  })
  return [...chosen, ...rest]
}
