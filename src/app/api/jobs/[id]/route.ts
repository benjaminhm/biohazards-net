/*
 * app/api/jobs/[id]/route.ts
 *
 * GET    /api/jobs/[id]  — fetch a single job + its photos in parallel
 * PATCH  /api/jobs/[id]  — partial update (status, fields, assessment_data, etc.)
 * DELETE /api/jobs/[id]  — hard delete the job record
 *
 * Every operation enforces org_id scoping (.eq('org_id', orgId)) so a user
 * in org A cannot access jobs in org B even if they know the UUID.
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { normalizeOptionalPhoneField } from '@/lib/phone'
import { ensureJobInboundEmailToken } from '@/lib/jobInboundEmail'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createServiceClient()

    const [jobRes, photosRes] = await Promise.all([
      supabase.from('jobs').select('*').eq('id', id).eq('org_id', orgId).single(),
      supabase.from('photos').select('*').eq('job_id', id).order('uploaded_at', { ascending: false }),
    ])

    if (jobRes.error) throw jobRes.error

    let job = jobRes.data
    let inbound_email_address: string | null = null
    if (job) {
      const ensured = await ensureJobInboundEmailToken(id, orgId)
      inbound_email_address = ensured.address
      if (ensured.token && !(job as { inbound_email_token?: string }).inbound_email_token) {
        job = { ...job, inbound_email_token: ensured.token }
      }
    }

    return NextResponse.json({ job, photos: photosRes.data ?? [], inbound_email_address })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as Record<string, unknown>
    delete body.inbound_email_token
    if (body.archived === true) {
      body.archived_at = new Date().toISOString()
      body.archived_by_user_id = userId ?? null
      delete body.archived
    } else if (body.archived === false) {
      body.archived_at = null
      body.archived_by_user_id = null
      delete body.archived
    } else if ('archived_at' in body) {
      if (body.archived_at === null || body.archived_at === '') {
        body.archived_by_user_id = null
      } else if (typeof body.archived_at === 'string') {
        body.archived_by_user_id = userId ?? null
      }
    }
    if ('client_phone' in body) {
      const pr = normalizeOptionalPhoneField(body.client_phone)
      if (!pr.ok) return NextResponse.json({ error: pr.error }, { status: 400 })
      if (pr.value === undefined) delete body.client_phone
      else body.client_phone = pr.value
    }
    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('jobs')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ job: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createServiceClient()
    const { error } = await supabase.from('jobs').delete().eq('id', id).eq('org_id', orgId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
