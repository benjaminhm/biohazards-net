/*
 * lib/photoPin.ts
 *
 * Shared by the photo host (photo.biohazards.net): the PIN camera (/api/photo)
 * and the bulk loader (/api/photo/bulk/*). A person signs in with their photo
 * PIN; photos are filed against a job by its 4-digit job code.
 */
import { createServiceClient } from '@/lib/supabase'
import { personShortCode } from '@/lib/phoneSignIn'

export interface PinPerson {
  person_id: string
  org_id: string
  name: string
  person_code: string
}

export interface PinJobOption {
  job_id: string | null
  job_code: string
  label: string
  address: string
}

type Supabase = ReturnType<typeof createServiceClient>

export function jobShortCode(jobId: string): string {
  return jobId.replace(/-/g, '').slice(0, 4).toUpperCase()
}

function toPinPerson(row: { id: unknown; org_id: unknown; name: unknown }): PinPerson {
  return {
    person_id: row.id as string,
    org_id: row.org_id as string,
    name: row.name as string,
    person_code: personShortCode(row.id as string),
  }
}

export async function resolvePersonByPin(pin: string): Promise<PinPerson | null> {
  const cleaned = pin.trim()
  if (!/^\d{4}$/.test(cleaned)) return null
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('people')
    .select('id, org_id, name, status')
    .eq('photo_pin', cleaned)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()
  if (error || !data || !data.org_id) return null
  return toPinPerson(data)
}

/** Re-checks a signed-in person on each request so archiving them or clearing their PIN ends access. */
export async function resolveActivePinPerson(personId: string, orgId: string): Promise<PinPerson | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('people')
    .select('id, org_id, name, status, photo_pin')
    .eq('id', personId)
    .eq('org_id', orgId)
    .eq('status', 'active')
    .maybeSingle()
  if (error || !data || !data.photo_pin) return null
  return toPinPerson(data)
}

export async function resolveJobForCode(
  supabase: Supabase,
  orgId: string,
  rawJobCode: string,
  explicitJobId: string,
): Promise<{ jobId: string | null; jobCode: string; address: string }> {
  const cleanedCode = rawJobCode.trim().toUpperCase().slice(0, 32)
  if (explicitJobId) {
    const { data: found } = await supabase
      .from('jobs')
      .select('id, job_code, site_address')
      .eq('id', explicitJobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (found?.id) {
      return {
        jobId: found.id as string,
        jobCode: (typeof found.job_code === 'string' && found.job_code.trim()) || cleanedCode || jobShortCode(found.id as string),
        address: String(found.site_address ?? '').trim(),
      }
    }
  }
  if (!cleanedCode) return { jobId: null, jobCode: '', address: '' }

  // 1. Direct match on jobs.job_code (4-digit dispatch code)
  const { data: directMatch } = await supabase
    .from('jobs')
    .select('id, job_code, site_address')
    .eq('org_id', orgId)
    .eq('job_code', cleanedCode)
    .is('archived_at', null)
    .limit(1)
    .maybeSingle()

  if (directMatch?.id) {
    return {
      jobId: directMatch.id as string,
      jobCode: (directMatch.job_code as string) || cleanedCode,
      address: String(directMatch.site_address ?? '').trim(),
    }
  }

  // 2. Fallback: match 4-char UUID prefix or document code suffix
  const stripped = cleanedCode.replace(/^(JOB|CCQ|SACQ|BCQ|CDR|SOA|RPT|QUO)-(\d{8}-)?/, '')
  const { data: deskJobs } = await supabase
    .from('jobs')
    .select('id, job_code, site_address')
    .eq('org_id', orgId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(100)

  const match = (deskJobs ?? []).find(row => {
    const code = jobShortCode(row.id as string)
    return code === cleanedCode || code === stripped
  })
  return {
    jobId: (match?.id as string | undefined) ?? null,
    jobCode: (match?.job_code as string | undefined) || cleanedCode,
    address: String(match?.site_address ?? '').trim(),
  }
}
