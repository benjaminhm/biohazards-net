import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Generates a unique 4-digit numeric job_code (e.g. "4821") for an active job in an org.
 * Team members receive this 4-digit code by SMS/dispatch and enter it on the photo app.
 */
export async function generateUniqueJobCode(
  supabase: SupabaseClient,
  orgId: string,
): Promise<string> {
  const { data } = await supabase
    .from('jobs')
    .select('job_code')
    .eq('org_id', orgId)
    .is('archived_at', null)
    .not('job_code', 'is', null)

  const used = new Set<string>(
    (data ?? [])
      .map(r => (typeof r.job_code === 'string' ? r.job_code.trim() : ''))
      .filter(Boolean),
  )

  for (let attempt = 0; attempt < 120; attempt++) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000))
    if (!used.has(candidate)) return candidate
  }

  for (let code = 1000; code <= 9999; code++) {
    const candidate = String(code)
    if (!used.has(candidate)) return candidate
  }

  return String(Math.floor(1000 + Math.random() * 9000))
}
