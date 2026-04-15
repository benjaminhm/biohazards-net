import type { SupabaseClient } from '@supabase/supabase-js'
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
    .select('area_ref, category, caption, capture_phase')
    .eq('job_id', jobId)
  if (r1.error && shouldRetryPhotoInsertWithoutCapturePhase(r1.error)) {
    return await supabase.from('photos').select('area_ref, category, caption').eq('job_id', jobId)
  }
  return r1
}
