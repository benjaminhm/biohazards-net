/*
 * app/api/company/route.ts
 *
 * GET   /api/company — the signed-in person's company profile
 * PATCH /api/company — upsert company profile (update if exists, insert if not)
 *
 * Both need a signed-in member of staff and only ever touch their own
 * organisation. /api/company is a public path in the proxy, so each handler
 * checks the session itself. Signed out, GET answers { company: null }.
 *
 * Never read company_profile without an org_id, and never take the
 * organisation from the host or a header: both are chosen by the sender.
 *
 * PGRST116 is the Supabase error code for "no rows found" on a .single() call —
 * treated as a valid empty result rather than an error.
 *
 * PATCH uses an upsert pattern: find existing row by org_id, then update
 * or insert. This avoids SQL upsert conflicts on the unique org_id constraint.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { normalizeOptionalPhoneField } from '@/lib/phone'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ company: null })
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ company: null })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('company_profile')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ company: data ?? null })
}

export async function PATCH(req: NextRequest) {
  // Checked before the body is read, so a signed-out request learns nothing.
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No organisation' }, { status: 403 })

  const supabase = createServiceClient()
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  // Which row and which organisation are decided here, never by the request.
  delete body.id
  delete body.org_id
  for (const key of ['subdomain', 'custom_domain']) {
    const value = body[key]
    if (typeof value === 'string') {
      body[key] = value.trim() || null
    }
  }
  if ('phone' in body) {
    const r = normalizeOptionalPhoneField(body.phone)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
    if (r.value === undefined) delete body.phone
    else body.phone = r.value
  }

  const { data: existing } = await supabase
    .from('company_profile')
    .select('id')
    .eq('org_id', orgId)
    .limit(1)
    .maybeSingle()

  let data, error

  if (existing?.id) {
    ;({ data, error } = await supabase
      .from('company_profile')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single())
  } else {
    ;({ data, error } = await supabase
      .from('company_profile')
      .insert({ ...body, org_id: orgId })
      .select()
      .single())
  }

  if (error) {
    if (error.code === '23505') {
      const message = error.message.includes('company_profile_custom_domain_key')
        ? 'That custom domain is already in use.'
        : error.message.includes('company_profile_subdomain_key')
          ? 'That subdomain is already in use.'
          : 'That company profile value is already in use.'
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ company: data })
}
