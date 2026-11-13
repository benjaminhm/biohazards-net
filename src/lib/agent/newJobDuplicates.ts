/*
 * lib/agent/newJobDuplicates.ts
 *
 * Open jobs in an organisation that are probably the same client or site as a
 * job about to be created. Shared by the head agent's new-job draft and the
 * phone new-job form (newjob.biohazards.net).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  duplicateSearchTerms,
  findDuplicates,
  type DuplicateCandidate,
  type NewJobProposal,
  type PossibleDuplicate,
} from './newJobDraft'

export async function likelyDuplicateJobs(
  supabase: SupabaseClient,
  orgId: string,
  p: NewJobProposal,
): Promise<PossibleDuplicate[]> {
  const { name, street } = duplicateSearchTerms(p)
  const ors = [
    ...(p.client_phone ? [`client_phone.eq."${p.client_phone}"`] : []),
    ...(p.client_email && !/[",()]/.test(p.client_email) ? [`client_email.ilike."${p.client_email}"`] : []),
    ...(name ? [`client_name.ilike.%${name}%`] : []),
    ...(street ? [`site_address.ilike.%${street}%`] : []),
  ]
  const cols = 'id, job_code, client_name, client_phone, client_phones, client_email, site_address, status'
  const base = () => supabase.from('jobs').select(cols).eq('org_id', orgId).is('archived_at', null)
  const [byFields, byOtherPhones] = await Promise.all([
    ors.length ? base().or(ors.join(',')).order('created_at', { ascending: false }).limit(300) : null,
    p.client_phone ? base().contains('client_phones', [{ number: p.client_phone }]).limit(20) : null,
  ])
  if (byFields?.error) throw byFields.error
  const seen = new Set<string>()
  const rows = [...(byFields?.data ?? []), ...(byOtherPhones?.data ?? [])].filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)))
  return findDuplicates(p, rows as DuplicateCandidate[])
}
