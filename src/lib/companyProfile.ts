/*
 * lib/companyProfile.ts
 *
 * The company profile (Settings) that goes on a job's documents: the one
 * belonging to the job's own organisation.
 *
 * Document routes have no signed-in user to take the organisation from, so it
 * comes from the job. Never read company_profile without an org_id: with more
 * than one organisation in the database that returns whichever row comes first.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CompanyProfile } from '@/lib/types'

/** Null when the job does not exist, has no organisation, or its organisation has no profile yet. */
export async function companyProfileForJob(
  supabase: SupabaseClient,
  jobId: string | null | undefined,
): Promise<CompanyProfile | null> {
  if (!jobId) return null
  const { data: job } = await supabase.from('jobs').select('org_id').eq('id', jobId).maybeSingle()
  const orgId = (job as { org_id?: string | null } | null)?.org_id
  if (!orgId) return null
  const { data } = await supabase.from('company_profile').select('*').eq('org_id', orgId).limit(1).maybeSingle()
  return (data as CompanyProfile | null) ?? null
}
