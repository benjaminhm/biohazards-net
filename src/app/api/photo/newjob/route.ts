/*
 * POST /api/photo/newjob — create a job from the phone new-job form
 * (newjob.biohazards.net), signed in with a photo PIN.
 *
 *   { ...Initial Contact fields, call_notes?, allow_duplicates? }
 *
 * The job is created in the PIN person's organisation with status 'lead'.
 * Open jobs that look like the same client or site are returned as 409
 * { duplicates } instead; the form sends allow_duplicates: true once the
 * person has confirmed it is a different job. That also stops a retry after a
 * dropped connection from creating the job twice.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { photoBulkPerson } from '@/lib/photoBulkSession'
import { generateUniqueJobCode } from '@/lib/jobCode'
import { ensureJobInboundEmailToken } from '@/lib/jobInboundEmail'
import { likelyDuplicateJobs } from '@/lib/agent/newJobDuplicates'
import {
  intakeDuplicateView,
  intakeJobRow,
  intakeNotesLog,
  intakeProposal,
  normalizeIntake,
} from '@/lib/newJobIntake'

export async function POST(req: Request) {
  const person = await photoBulkPerson(req)
  if (!person) return NextResponse.json({ error: 'Signed out. Enter your PIN again.' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const checked = normalizeIntake(body)
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })

  try {
    const supabase = createServiceClient()
    if (body.allow_duplicates !== true) {
      const duplicates = await likelyDuplicateJobs(supabase, person.org_id, intakeProposal(checked.job))
      if (duplicates.length) {
        return NextResponse.json(
          { error: 'This looks like a job that already exists.', duplicates: intakeDuplicateView(duplicates) },
          { status: 409 },
        )
      }
    }

    const jobCode = await generateUniqueJobCode(supabase, person.org_id)
    const row = intakeJobRow(checked.job, jobCode, person.org_id, intakeNotesLog(person.name, checked.callNotes))
    const { data, error } = await supabase
      .from('jobs')
      .insert(row)
      .select('id, job_code, client_name, client_organization_name, site_address')
      .single()
    if (error || !data) throw error ?? new Error('Could not create the job.')

    // The job exists from here on, so a failure below must not read as "not created".
    try {
      await ensureJobInboundEmailToken(data.id as string, person.org_id)
    } catch (err) {
      console.error('[newjob] inbound email token failed', err)
    }

    return NextResponse.json({
      job: {
        id: data.id as string,
        job_code: (data.job_code as string | null) ?? jobCode,
        client_name: (data.client_name as string | null) || (data.client_organization_name as string | null) || '',
        site_address: (data.site_address as string | null) ?? '',
      },
    }, { status: 201 })
  } catch (err) {
    console.error('[newjob] create failed', err)
    const message = err instanceof Error ? err.message : (err as { message?: string } | null)?.message
    return NextResponse.json({ error: message || 'Could not create the job.' }, { status: 500 })
  }
}
