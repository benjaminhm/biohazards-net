/*
 * lib/jobInboundEmail.ts
 *
 * Pilot feature: per-job inbound email address for selected org slugs
 * (JOB_INBOUND_EMAIL_ORG_SLUGS). Token stored on jobs.inbound_email_token;
 * inbound provider posts to /api/webhooks/inbound-email.
 */
import { randomBytes } from 'crypto'
import { createServiceClient } from '@/lib/supabase'

export function pilotInboundEmailSlugs(): string[] {
  return (process.env.JOB_INBOUND_EMAIL_ORG_SLUGS ?? 'brisbanebiohazardcleaning')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function inboundEmailDomain(): string {
  return process.env.INBOUND_EMAIL_DOMAIN ?? 'inbound.biohazards.net'
}

export function buildJobInboundAddress(token: string): string {
  return `${token}@${inboundEmailDomain()}`
}

function generateToken(): string {
  return randomBytes(24).toString('hex')
}

/** Returns address when this org is in the pilot list; creates token if missing. */
export async function ensureJobInboundEmailToken(
  jobId: string,
  orgId: string
): Promise<{ token: string | null; address: string | null }> {
  const supabase = createServiceClient()
  const { data: org } = await supabase.from('orgs').select('slug').eq('id', orgId).single()
  if (!org?.slug || !pilotInboundEmailSlugs().includes(org.slug)) {
    return { token: null, address: null }
  }

  const { data: row } = await supabase
    .from('jobs')
    .select('inbound_email_token')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .single()

  if (!row) return { token: null, address: null }

  if (row.inbound_email_token) {
    return { token: row.inbound_email_token, address: buildJobInboundAddress(row.inbound_email_token) }
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    const token = generateToken()
    const { data: updated, error } = await supabase
      .from('jobs')
      .update({ updated_at: new Date().toISOString(), inbound_email_token: token })
      .eq('id', jobId)
      .eq('org_id', orgId)
      .is('inbound_email_token', null)
      .select('inbound_email_token')
      .maybeSingle()

    if (!error && updated?.inbound_email_token) {
      return { token: updated.inbound_email_token, address: buildJobInboundAddress(updated.inbound_email_token) }
    }
  }

  return { token: null, address: null }
}
