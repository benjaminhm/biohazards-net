import type { SupabaseClient } from '@supabase/supabase-js'

/** PostgREST PGRST204 / unknown column — often `capture_phase` before migration 027 or stale schema cache. */
export function shouldRetryPhotoInsertWithoutCapturePhase(e: {
  code?: string
  message?: string
}): boolean {
  const msg = (e.message ?? '').toLowerCase()
  return (
    e.code === 'PGRST204' ||
    msg.includes('capture_phase') ||
    (msg.includes('schema cache') && msg.includes('column'))
  )
}

export type PhotoInsertRow = {
  job_id: string
  file_url: string
  caption: string
  area_ref: string
  category: string
  capture_phase: string
  org_id?: string
  /** Defaults true in DB; omit on legacy inserts after column retries. */
  include_in_composed_reports?: boolean
}

export async function insertPhotoRow(supabase: SupabaseClient, row: PhotoInsertRow) {
  let ins = await supabase.from('photos').insert(row).select().single()

  // Drop newest optional columns first (migration 033), then capture_phase (027).
  if (ins.error && shouldRetryPhotoInsertWithoutCapturePhase(ins.error)) {
    const { include_in_composed_reports: _i, ...withoutInclude } = row
    ins = await supabase.from('photos').insert(withoutInclude).select().single()
  }
  if (ins.error && shouldRetryPhotoInsertWithoutCapturePhase(ins.error)) {
    const { capture_phase: _c, include_in_composed_reports: _i, ...minimal } = row
    ins = await supabase.from('photos').insert(minimal).select().single()
  }

  return ins
}
