/*
 * GET /api/photo/bulk/job?code=3456 — find an open job in the signed-in
 * person's organisation by its job code, so the loader can confirm it.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { resolveJobForCode } from '@/lib/photoPin'
import { photoBulkPerson } from '@/lib/photoBulkSession'

export async function GET(req: Request) {
  const person = await photoBulkPerson(req)
  if (!person) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const code = new URL(req.url).searchParams.get('code') ?? ''
  if (!code.trim()) return NextResponse.json({ error: 'Enter a job code.' }, { status: 400 })

  const supabase = createServiceClient()
  const { jobId, jobCode } = await resolveJobForCode(supabase, person.org_id, code, '')
  if (!jobId) return NextResponse.json({ error: `No open job with code ${code.trim().toUpperCase()}.` }, { status: 404 })

  const { data: job } = await supabase
    .from('jobs')
    .select('id, job_code, client_name, site_address')
    .eq('id', jobId)
    .eq('org_id', person.org_id)
    .maybeSingle()
  if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 })

  return NextResponse.json({
    job: {
      id: job.id as string,
      job_code: (job.job_code as string | null) || jobCode,
      client_name: (job.client_name as string | null) ?? '',
      site_address: (job.site_address as string | null) ?? '',
    },
  })
}
