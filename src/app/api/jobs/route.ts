/*
 * app/api/jobs/route.ts
 *
 * GET  /api/jobs          — list all jobs for the current org
 * POST /api/jobs          — create a new job (status defaults to 'lead').
 *                            { blank: true } creates an empty job that staff fill
 *                            in from Initial Contact (Job Manager's + New Job).
 *
 * GET supports ?upcoming=true to fetch the next 10 scheduled jobs in
 * chronological order (used by the field schedule view).
 * All queries are scoped by org_id to enforce tenancy isolation.
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { normalizeOptionalPhoneField } from '@/lib/phone'
import { ensureJobInboundEmailToken } from '@/lib/jobInboundEmail'
import { isTradingNameId, TRADING_NAME_IDS } from '@/lib/tradingNames'
import { generateUniqueJobCode } from '@/lib/jobCode'

export async function GET(req: Request) {
  try {
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const upcoming          = searchParams.get('upcoming') === 'true'
    const includeArchived   = searchParams.get('include_archived') === 'true'
    const supabase = createServiceClient()

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

    const blank = body.blank === true
    if (!blank && (!client_name || !site_address || !job_type)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    let clientPhoneOut = ''
    if (client_phone != null && String(client_phone).trim() !== '') {
      const pr = normalizeOptionalPhoneField(client_phone)
      if (!pr.ok) return NextResponse.json({ error: pr.error }, { status: 400 })
      clientPhoneOut = pr.value ?? ''
    }

    const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '')
    const num = (k: string) => (typeof body[k] === 'number' ? (body[k] as number) : null)

    let trading_name: string | null = null
    if (body.trading_name != null && body.trading_name !== '') {
      if (!isTradingNameId(body.trading_name)) {
        return NextResponse.json(
          { error: `Invalid trading_name. Use one of: ${TRADING_NAME_IDS.join(', ')}.` },
          { status: 400 },
        )
      }
      trading_name = body.trading_name
    }

    const supabase = createServiceClient()
    const job_code = await generateUniqueJobCode(supabase, orgId)
    const { data, error } = await supabase
      .from('jobs')
      .insert({
        job_code,
        client_name: client_name || '',
        client_organization_name: str('client_organization_name'),
        client_contact_role: str('client_contact_role'),
        client_contact_relationship: str('client_contact_relationship'),
        insurance_claim_ref: str('insurance_claim_ref'),
        trading_name,
        client_phone: clientPhoneOut,
        client_email: client_email ?? '',
        site_address: site_address || '',
        site_place_id: str('site_place_id'),
        site_lat: num('site_lat'),
        site_lng: num('site_lng'),
        job_type: job_type || 'other',
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
