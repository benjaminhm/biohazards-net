/*
 * app/api/jobs/[id]/prestart-briefings/route.ts
 *
 * Admin/manager job-file endpoint for pre-start briefing videos and notes.
 * Briefings are job-scoped; acknowledgements are person-scoped.
 */
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { verifyImpersonationFromRequest } from '@/lib/impersonation'

type ServiceClient = ReturnType<typeof createServiceClient>

const MAX_TITLE = 240
const MAX_DESCRIPTION = 50_000
const MAX_URL = 4_000

interface OrgUserRow {
  role: string | null
}

interface BriefingPayload {
  briefing_id?: string
  title?: string
  description?: string
  video_url?: string
  thumbnail_url?: string | null
}

function isFullJobFileRole(role: string | null | undefined) {
  return role === 'admin' || role === 'owner' || role === 'manager' || role === 'team_lead'
}

async function canUseFullJobFile(req: Request, userId: string, orgId: string, supabase: ServiceClient) {
  const impersonation = await verifyImpersonationFromRequest(req, userId)
  if (impersonation?.orgId === orgId) return true

  const { data, error } = await supabase
    .from('org_users')
    .select('role')
    .eq('clerk_user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw error
  return isFullJobFileRole((data as OrgUserRow | null)?.role)
}

async function assertJob(supabase: ServiceClient, jobId: string, orgId: string) {
  const { data, error } = await supabase
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw error
  return !!data
}

function normalizeUrl(value: unknown, label: string, required: boolean) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) {
    if (required) throw new Error(`${label} is required`)
    return null
  }
  if (trimmed.length > MAX_URL) throw new Error(`${label} is too long`)
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`${label} must be an http or https URL`)
    }
    return parsed.toString()
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }
}

function normalizePayload(body: BriefingPayload, partial = false) {
  const patch: Record<string, string | null> = {}

  if (!partial || 'title' in body) {
    const title = (body.title ?? '').trim()
    if (!title) throw new Error('Title is required')
    if (title.length > MAX_TITLE) throw new Error(`Title must be at most ${MAX_TITLE} characters`)
    patch.title = title
  }

  if (!partial || 'description' in body) {
    const description = (body.description ?? '').trim()
    if (description.length > MAX_DESCRIPTION) throw new Error(`Notes must be at most ${MAX_DESCRIPTION} characters`)
    patch.description = description
  }

  if (!partial || 'video_url' in body) {
    patch.video_url = normalizeUrl(body.video_url, 'Video URL', true)
  }

  if ('thumbnail_url' in body) {
    patch.thumbnail_url = normalizeUrl(body.thumbnail_url, 'Thumbnail URL', false)
  }

  return patch
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: jobId } = await params
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })

    const supabase = createServiceClient()
    if (!(await canUseFullJobFile(req, userId, orgId, supabase))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!(await assertJob(supabase, jobId, orgId))) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const [{ data: briefings, error: briefingsError }, { data: acknowledgements, error: ackError }] = await Promise.all([
      supabase
        .from('job_prestart_briefings')
        .select('*')
        .eq('org_id', orgId)
        .eq('job_id', jobId)
        .order('created_at', { ascending: true }),
      supabase
        .from('job_prestart_acknowledgements')
        .select('*, people(id, name, role)')
        .eq('org_id', orgId)
        .eq('job_id', jobId)
        .order('updated_at', { ascending: false }),
    ])

    if (briefingsError) throw briefingsError
    if (ackError) throw ackError

    return NextResponse.json({
      briefings: briefings ?? [],
      acknowledgements: acknowledgements ?? [],
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not load pre-start briefings'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: jobId } = await params
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })

    const supabase = createServiceClient()
    if (!(await canUseFullJobFile(req, userId, orgId, supabase))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!(await assertJob(supabase, jobId, orgId))) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = (await req.json()) as BriefingPayload
    const patch = normalizePayload(body)
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('job_prestart_briefings')
      .insert({
        ...patch,
        org_id: orgId,
        job_id: jobId,
        created_at: now,
        updated_at: now,
        created_by_user_id: userId,
        updated_by_user_id: userId,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ briefing: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not save pre-start briefing'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: jobId } = await params
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })

    const supabase = createServiceClient()
    if (!(await canUseFullJobFile(req, userId, orgId, supabase))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await req.json()) as BriefingPayload
    const briefingId = (body.briefing_id ?? '').trim()
    if (!briefingId) return NextResponse.json({ error: 'briefing_id is required' }, { status: 400 })

    const patch = normalizePayload(body, true)
    const { data, error } = await supabase
      .from('job_prestart_briefings')
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
        updated_by_user_id: userId,
      })
      .eq('id', briefingId)
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ briefing: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not update pre-start briefing'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: jobId } = await params
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })

    const supabase = createServiceClient()
    if (!(await canUseFullJobFile(req, userId, orgId, supabase))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await req.json()) as BriefingPayload
    const briefingId = (body.briefing_id ?? '').trim()
    if (!briefingId) return NextResponse.json({ error: 'briefing_id is required' }, { status: 400 })

    const { error } = await supabase
      .from('job_prestart_briefings')
      .delete()
      .eq('id', briefingId)
      .eq('job_id', jobId)
      .eq('org_id', orgId)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not delete pre-start briefing'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
