/*
 * app/api/field/jobs/route.ts
 *
 * Stable field-worker job list. Returns only sanitised job fields and only jobs
 * the current user is allowed to see: assigned jobs for members, all active org
 * jobs for roles/capabilities that can view all jobs.
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import {
  ACTIVE_FIELD_STATUSES,
  FIELD_JOB_SELECT,
  type FieldJobRow,
  type OrgUserAccessRow,
  resolveFieldAccess,
  sanitizeFieldJob,
} from '@/lib/fieldJobs'

export async function GET(req: Request) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createServiceClient()
    const { data: orgUser, error: orgUserError } = await supabase
      .from('org_users')
      .select('role, person_id, capabilities')
      .eq('clerk_user_id', userId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (orgUserError) throw orgUserError

    const access = resolveFieldAccess(orgUser as OrgUserAccessRow | null)
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    let jobIds: string[] | null = null
    if (!access.canViewAllJobs) {
      if (!access.personId) return NextResponse.json({ jobs: [] })

      const { data: assignments, error: assignmentError } = await supabase
        .from('job_assignments')
        .select('job_id')
        .eq('person_id', access.personId)
        .eq('org_id', orgId)

      if (assignmentError) throw assignmentError

      jobIds = (assignments ?? [])
        .map((assignment: { job_id: string | null }) => assignment.job_id)
        .filter((jobId: string | null): jobId is string => !!jobId)

      if (jobIds.length === 0) return NextResponse.json({ jobs: [] })
    }

    let query = supabase
      .from('jobs')
      .select(FIELD_JOB_SELECT)
      .eq('org_id', orgId)
      .is('archived_at', null)
      .in('status', ACTIVE_FIELD_STATUSES)
      .order('scheduled_at', { ascending: true, nullsFirst: false })

    if (jobIds) query = query.in('id', jobIds)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({
      jobs: ((data ?? []) as unknown as FieldJobRow[]).map(sanitizeFieldJob),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
