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
  type FieldAssignedTask,
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

    const jobs = ((data ?? []) as unknown as FieldJobRow[]).map(sanitizeFieldJob)
    if (access.personId && jobs.length > 0) {
      const { data: taskRows, error: taskError } = await supabase
        .from('person_job_tasks')
        .select('id, job_id, body, completed')
        .eq('org_id', orgId)
        .eq('person_id', access.personId)
        .in('job_id', jobs.map(job => job.id))
        .order('created_at', { ascending: true })

      if (taskError) throw taskError
      const tasksByJob = ((taskRows ?? []) as FieldAssignedTask[]).reduce<Record<string, FieldAssignedTask[]>>((acc, task) => {
        acc[task.job_id] = [...(acc[task.job_id] ?? []), task]
        return acc
      }, {})
      for (const job of jobs) job.assigned_tasks = tasksByJob[job.id] ?? []
    }

    return NextResponse.json({ jobs })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
