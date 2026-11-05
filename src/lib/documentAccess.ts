/*
 * lib/documentAccess.ts
 *
 * Org checks for the staff document routes. Older documents were saved without
 * org_id, so for those the owning job's org decides.
 */
import type { createServiceClient } from '@/lib/supabase'

type ServiceClient = ReturnType<typeof createServiceClient>

export async function jobInOrg(supabase: ServiceClient, jobId: string, orgId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return false
  const { data } = await supabase.from('jobs').select('id').eq('id', jobId).eq('org_id', orgId).maybeSingle()
  return Boolean(data)
}

export async function documentInOrg(supabase: ServiceClient, documentId: string, orgId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return false
  const { data } = await supabase.from('documents').select('org_id, job_id').eq('id', documentId).maybeSingle()
  if (!data) return false
  if (data.org_id) return data.org_id === orgId
  return data.job_id ? jobInOrg(supabase, data.job_id as string, orgId) : false
}
