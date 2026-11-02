/*
 * Resolve a sign-in email to one active person who has phone sign-in.
 * The owner allowlist never reaches this. Zero matches and two matches both
 * return null so the caller can answer with the same generic success.
 */
import { createServiceClient } from '@/lib/supabase'
import { normaliseStaffEmail } from '@/lib/staffLogin'

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, ch => `\\${ch}`)
}

export async function lookupStaffIdentityByEmail(email: string): Promise<{ userId: string } | null> {
  const normalised = normaliseStaffEmail(email)
  if (!normalised) return null

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('people')
    .select('id, email, status, org_id')
    .ilike('email', escapeIlike(normalised))
    .eq('status', 'active')
  if (error || !data) return null

  const matches = data.filter(row => normaliseStaffEmail(row.email) === normalised)
  if (matches.length !== 1) return null
  const person = matches[0]
  if (!person.org_id) return null

  const { data: org } = await supabase
    .from('orgs')
    .select('is_active')
    .eq('id', person.org_id)
    .maybeSingle()
  if (!org?.is_active) return null

  const { data: accessRows, error: accessError } = await supabase
    .from('org_users')
    .select('clerk_user_id, role, is_active')
    .eq('person_id', person.id)
    .eq('org_id', person.org_id)
    .eq('is_active', true)
  if (accessError || !accessRows || accessRows.length !== 1) return null

  const access = accessRows[0]
  if (access.role !== 'admin' && access.role !== 'member') return null
  const userId = typeof access.clerk_user_id === 'string' ? access.clerk_user_id.trim() : ''
  if (!userId) return null
  return { userId }
}
