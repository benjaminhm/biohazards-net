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
}

export async function insertPhotoRow(supabase: SupabaseClient, row: PhotoInsertRow) {
  let ins = await supabase.from('photos').insert(row).select().single()

  if (ins.error && shouldRetryPhotoInsertWithoutCapturePhase(ins.error)) {
    const { capture_phase: _c, ...legacy } = row
    ins = await supabase.from('photos').insert(legacy).select().single()
  }

  return ins
}
