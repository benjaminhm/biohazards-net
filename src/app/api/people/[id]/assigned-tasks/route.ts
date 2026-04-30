/*
 * app/api/people/[id]/assigned-tasks/route.ts
 *
 * Person-scoped job task management for Team → Jobs cards.
 * Tasks belong to one person on one job, so two assignees can have different
 * instructions for the same job.
 */
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

const MAX_TASK_BODY = 5000

async function assertPerson(
  supabase: ReturnType<typeof createServiceClient>,
  personId: string,
  orgId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('people')
    .select('id')
    .eq('id', personId)
    .eq('org_id', orgId)
    .maybeSingle()
  return !!data
}

async function assertAssignedJob(
  supabase: ReturnType<typeof createServiceClient>,
  personId: string,
  jobId: string,
  orgId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('job_assignments')
    .select('id')
    .eq('person_id', personId)
    .eq('job_id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()
  return !!data
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })
    const { id: personId } = await params

    const supabase = createServiceClient()
    if (!(await assertPerson(supabase, personId, orgId))) {
      return NextResponse.json({ error: 'Person not found' }, { status: 404 })
    }

    const { data, error } = await supabase
      .from('person_job_tasks')
      .select('*')
      .eq('org_id', orgId)
      .eq('person_id', personId)
      .order('created_at', { ascending: true })

    if (error) throw error
    return NextResponse.json({ tasks: data ?? [] })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not load assigned tasks' },
      { status: 500 },
    )
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })
    const { id: personId } = await params
    const body = (await req.json()) as { job_id?: string; body?: string }
    const jobId = (body.job_id ?? '').trim()
    const taskBody = (body.body ?? '').trim().slice(0, MAX_TASK_BODY)
    if (!jobId) return NextResponse.json({ error: 'job_id is required' }, { status: 400 })
    if (!taskBody) return NextResponse.json({ error: 'Task is required' }, { status: 400 })

    const supabase = createServiceClient()
    if (!(await assertPerson(supabase, personId, orgId))) {
      return NextResponse.json({ error: 'Person not found' }, { status: 404 })
    }
    if (!(await assertAssignedJob(supabase, personId, jobId, orgId))) {
      return NextResponse.json({ error: 'Assign this person to the job before adding tasks' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('person_job_tasks')
      .insert({
        org_id: orgId,
        job_id: jobId,
        person_id: personId,
        body: taskBody,
        created_at: now,
        updated_at: now,
        created_by_user_id: userId,
        updated_by_user_id: userId,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ task: data })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not add assigned task' },
      { status: 500 },
    )
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })
    const { id: personId } = await params
    const body = (await req.json()) as { task_id?: string; body?: string; completed?: boolean }
    const taskId = (body.task_id ?? '').trim()
    if (!taskId) return NextResponse.json({ error: 'task_id is required' }, { status: 400 })

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by_user_id: userId,
    }
    if (typeof body.completed === 'boolean') patch.completed = body.completed
    if (typeof body.body === 'string') {
      const taskBody = body.body.trim().slice(0, MAX_TASK_BODY)
      if (!taskBody) return NextResponse.json({ error: 'Task is required' }, { status: 400 })
      patch.body = taskBody
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('person_job_tasks')
      .update(patch)
      .eq('id', taskId)
      .eq('person_id', personId)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ task: data })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not update assigned task' },
      { status: 500 },
    )
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })
    const { id: personId } = await params
    const body = (await req.json()) as { task_id?: string }
    const taskId = (body.task_id ?? '').trim()
    if (!taskId) return NextResponse.json({ error: 'task_id is required' }, { status: 400 })

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('person_job_tasks')
      .delete()
      .eq('id', taskId)
      .eq('person_id', personId)
      .eq('org_id', orgId)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not delete assigned task' },
      { status: 500 },
    )
  }
}
