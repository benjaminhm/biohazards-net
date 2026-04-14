/*
 * app/api/jobs/route.ts
 *
 * GET  /api/jobs          — list all jobs for the current org
 * POST /api/jobs          — create a new job (status defaults to 'lead')
 *
 * GET supports ?upcoming=true to fetch the next 10 scheduled jobs in
 * chronological order (used by the field schedule view).
 * All queries are scoped by org_id to enforce tenancy isolation.
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { normalizeOptionalPhoneField } from '@/lib/phone'
import { ensureJobInboundEmailToken } from '@/lib/jobInboundEmail'

export async function GET(req: Request) {
  try {
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const upcoming          = searchParams.get('upcoming') === 'true'
    const assignedOnly      = searchParams.get('assigned_only') === 'true'
    const previewPersonId   = searchParams.get('preview_person_id')
    const includeArchived   = searchParams.get('include_archived') === 'true'
    const supabase = createServiceClient()

    // preview_person_id — admin fetching another person's assigned jobs for live preview.
    // Requires the caller to be an admin; returns the same shape as assigned_only.
    if (previewPersonId) {
      const { data: me } = await supabase
        .from('org_users')
        .select('role')
        .eq('clerk_user_id', userId!)
        .eq('org_id', orgId)
        .single()
      if (!me || (me.role !== 'admin' && me.role !== 'owner' && me.role !== 'manager')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const { data: assignments } = await supabase
        .from('job_assignments')
        .select('job_id')
        .eq('person_id', previewPersonId)
        .eq('org_id', orgId)
      const jobIds = (assignments ?? []).map((a: { job_id: string }) => a.job_id)
      if (jobIds.length === 0) return NextResponse.json({ jobs: [] })
      let q = supabase
        .from('jobs')
        .select('*')
        .eq('org_id', orgId)
        .in('id', jobIds)
        .order('scheduled_at', { ascending: true, nullsFirst: false })
      if (!includeArchived) q = q.is('archived_at', null)
      const { data, error } = await q
      if (error) throw error
      return NextResponse.json({ jobs: data })
    }

    // assigned_only=true — return only jobs this user is assigned to via job_assignments.
    // Used by the field page so team members only see their own jobs.
    if (assignedOnly) {
      // Get the user's person_id from org_users
      const { data: orgUser } = await supabase
        .from('org_users')
        .select('person_id')
        .eq('clerk_user_id', userId!)
        .single()

      if (!orgUser?.person_id) {
        // No person profile linked — return empty rather than all jobs
        return NextResponse.json({ jobs: [] })
      }

      // Fetch job_ids assigned to this person
      const { data: assignments } = await supabase
        .from('job_assignments')
        .select('job_id')
        .eq('person_id', orgUser.person_id)
        .eq('org_id', orgId)

      const jobIds = (assignments ?? []).map(a => a.job_id)
      if (jobIds.length === 0) return NextResponse.json({ jobs: [] })

      let q = supabase
        .from('jobs')
        .select('*')
        .eq('org_id', orgId)
        .in('id', jobIds)
        .order('scheduled_at', { ascending: true, nullsFirst: false })
      if (!includeArchived) q = q.is('archived_at', null)

      const { data, error } = await q

      if (error) throw error
      return NextResponse.json({ jobs: data })
    }

    let query = supabase.from('jobs').select('*').eq('org_id', orgId)
    if (!includeArchived) query = query.is('archived_at', null)

    if (upcoming) {
      query = query
        .not('scheduled_at', 'is', null)
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(10)
    } else {
      query = query.order('created_at', { ascending: false })
    }

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ jobs: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json() as Record<string, unknown>
    const client_name = body.client_name
    const client_phone = body.client_phone
    const client_email = body.client_email
    const site_address = body.site_address
    const job_type = body.job_type
    const urgency = body.urgency

    if (!client_name || !site_address || !job_type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    let clientPhoneOut = ''
    if (client_phone != null && String(client_phone).trim() !== '') {
      const pr = normalizeOptionalPhoneField(client_phone)
      if (!pr.ok) return NextResponse.json({ error: pr.error }, { status: 400 })
      clientPhoneOut = pr.value ?? ''
    }

    const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '')

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('jobs')
      .insert({
        client_name,
        client_organization_name: str('client_organization_name'),
        client_contact_role: str('client_contact_role'),
        client_contact_relationship: str('client_contact_relationship'),
        insurance_claim_ref: str('insurance_claim_ref'),
        client_phone: clientPhoneOut,
        client_email: client_email ?? '',
        site_address,
        job_type,
        urgency: urgency ?? 'standard',
        status: 'lead',
        notes: '',
        assessment_data: null,
        org_id: orgId,
      })
      .select()
      .single()

    if (error) throw error

    const ensured = await ensureJobInboundEmailToken(data.id, orgId)
    const job =
      ensured.token && !(data as { inbound_email_token?: string }).inbound_email_token
        ? { ...data, inbound_email_token: ensured.token }
        : data

    return NextResponse.json({ job, inbound_email_address: ensured.address }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
