/*
 * app/api/jobs/[id]/team/route.ts
 *
 * GET  /api/jobs/[id]/team — list people assigned to this job (with person details)
 * POST /api/jobs/[id]/team — assign a person to a job
 *
 * Uses the job_assignments join table. Returns 409 on duplicate assignment
 * (Postgres unique constraint code 23505).
 *
 * On successful assignment, fires a Resend email to the person if they have
 * an email on record. This is the only team notification — we use email not SMS
 * for internal comms to keep Twilio costs reserved for client-facing messages.
 * Email failure is logged but never blocks the assignment response.
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

async function getOrgId(userId: string) {
  const supabase = createServiceClient()
  const { data } = await supabase.from('org_users').select('org_id').eq('clerk_user_id', userId).single()
  return data?.org_id ?? null
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = await getOrgId(userId)
  if (!orgId) return NextResponse.json({ assignments: [] })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('job_assignments')
    .select('*, people(id, name, role, phone, email, status)')
    .eq('job_id', jobId)
    .eq('org_id', orgId)
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ assignments: data ?? [] })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = await getOrgId(userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 })

  const { person_id } = await req.json()
  if (!person_id) return NextResponse.json({ error: 'person_id required' }, { status: 400 })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('job_assignments')
    .insert({ job_id: jobId, person_id, org_id: orgId })
    .select('*, people(id, name, role, phone, email, status)')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Already assigned' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fire assignment email — non-blocking, never delays the response
  const person = data.people as { name: string; email?: string } | null
  if (person?.email) {
    // Fetch job + org name for the email body
    const { data: job } = await supabase
      .from('jobs')
      .select('client_name, site_address, job_type, scheduled_at, orgs(name)')
      .eq('id', jobId)
      .single()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orgName = (job as any)?.orgs?.name ?? 'Biohazard Cleaning'
    const jobTypeLabel = (job?.job_type ?? '').replace(/_/g, ' ')
    const scheduledStr = job?.scheduled_at
      ? new Date(job.scheduled_at).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : 'TBC'

    resend.emails.send({
      from: 'notifications@biohazards.net',
      to: person.email,
      subject: `You've been assigned to a job — ${job?.client_name ?? 'New Job'}`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
          <div style="background:#FF6B35;height:4px;border-radius:2px;margin-bottom:24px"></div>
          <h2 style="margin:0 0 4px;font-size:20px;color:#111">Job Assignment</h2>
          <p style="margin:0 0 24px;color:#666;font-size:14px">${orgName}</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            ${[
              ['Client',    job?.client_name ?? '—'],
              ['Address',   job?.site_address ?? '—'],
              ['Job type',  jobTypeLabel || '—'],
              ['Scheduled', scheduledStr],
            ].map(([label, value]) => `
              <tr>
                <td style="padding:8px 0;color:#888;width:90px;vertical-align:top">${label}</td>
                <td style="padding:8px 0;color:#111;font-weight:500">${value}</td>
              </tr>
            `).join('')}
          </table>
          <div style="margin-top:24px;padding-top:20px;border-top:1px solid #eee">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}"
               style="display:inline-block;padding:12px 20px;background:#FF6B35;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">
              Open App →
            </a>
          </div>
          <p style="margin-top:20px;font-size:12px;color:#bbb">biohazards.net</p>
        </div>
      `,
    }).catch(err => console.error('Assignment email failed:', err))
  }

  return NextResponse.json({ assignment: data })
}

// DELETE /api/jobs/[id]/team — remove a person from a job
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = await getOrgId(userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 })

  const { person_id } = await req.json()
  if (!person_id) return NextResponse.json({ error: 'person_id required' }, { status: 400 })

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('job_assignments')
    .delete()
    .eq('job_id', jobId)
    .eq('person_id', person_id)
    .eq('org_id', orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
