/*
 * app/api/field/jobs/[id]/prestart-briefings/[briefingId]/acknowledge/route.ts
 *
 * Field-worker acknowledgement for a job pre-start briefing.
 */
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { type OrgUserAccessRow, resolveFieldAccess } from '@/lib/fieldJobs'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; briefingId: string }> },
) {
  try {
    const { id: jobId, briefingId } = await params
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })

    const supabase = createServiceClient()
    const { data: orgUser, error: orgUserError } = await supabase
      .from('org_users')
      .select('role, person_id, capabilities')
      .eq('clerk_user_id', userId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (orgUserError) throw orgUserError
    const access = resolveFieldAccess(orgUser as OrgUserAccessRow | null)
    if (!access?.personId) return NextResponse.json({ error: 'No team member profile linked' }, { status: 403 })

    const [{ data: assignment, error: assignmentError }, { data: briefing, error: briefingError }] = await Promise.all([
      supabase
        .from('job_assignments')
        .select('id')
        .eq('job_id', jobId)
        .eq('org_id', orgId)
        .eq('person_id', access.personId)
        .maybeSingle(),
      supabase
        .from('job_prestart_briefings')
        .select('id')
        .eq('id', briefingId)
        .eq('job_id', jobId)
        .eq('org_id', orgId)
        .maybeSingle(),
    ])

    if (assignmentError) throw assignmentError
    if (briefingError) throw briefingError
    if (!assignment && !access.canViewAllJobs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!briefing) return NextResponse.json({ error: 'Briefing not found' }, { status: 404 })

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('job_prestart_acknowledgements')
      .upsert({
        org_id: orgId,
        job_id: jobId,
        briefing_id: briefingId,
        person_id: access.personId,
        viewed_at: now,
        acknowledged_at: now,
        updated_at: now,
      }, { onConflict: 'org_id,briefing_id,person_id' })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ acknowledgement: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not acknowledge briefing'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
