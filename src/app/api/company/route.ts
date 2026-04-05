/*
 * app/api/company/route.ts
 *
 * GET   /api/company — fetch company profile for the current tenant
 * PATCH /api/company — upsert company profile (update if exists, insert if not)
 *
 * GET resolution order (most specific to least):
 *   1. x-org-slug header (marketing subdomain / site)
 *   2. Authenticated: getOrgId (membership or platform impersonation) → company_profile.org_id
 *   3. x-tenant-host legacy lookup (subdomain / custom_domain on company_profile)
 *
 * Never use an unscoped limit(1) on company_profile — that returned an arbitrary tenant.
 *
 * PGRST116 is the Supabase error code for "no rows found" on a .single() call —
 * treated as a valid empty result rather than an error.
 *
 * PATCH uses an upsert pattern: find existing row by org_id, then update
 * or insert. This avoids SQL upsert conflicts on the unique org_id constraint.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { normalizeOptionalPhoneField } from '@/lib/phone'

function extractSubdomain(host: string): string | null {
  // brisbanebiohazardcleaning.biohazards.net → brisbanebiohazardcleaning
  // app.brisbanebiohazardcleaning.com.au → null (custom domain lookup instead)
  const bhMatch = host.match(/^([^.]+)\.biohazards\.net$/)
  return bhMatch ? bhMatch[1] : null
}

export async function GET(req: NextRequest) {
  const supabase = createServiceClient()
  const tenantHost = req.headers.get('x-tenant-host')
  const orgSlugHeader = req.headers.get('x-org-slug')

  // If we have an org slug from middleware, try to find company_profile by org_id
  if (orgSlugHeader && orgSlugHeader !== 'app' && orgSlugHeader !== 'admin') {
    const { data: org } = await supabase
      .from('orgs')
      .select('id')
      .eq('slug', orgSlugHeader)
      .eq('is_active', true)
      .single()

    if (org?.id) {
      const { data, error } = await supabase
        .from('company_profile')
        .select('*')
        .eq('org_id', org.id)
        .limit(1)
        .single()

      if (!error || error.code === 'PGRST116') {
        return NextResponse.json({ company: data ?? null })
      }
    }
  }

  // Main app (app.biohazards.net, localhost): tenant from membership or impersonation
  const { userId } = await auth()
  if (userId) {
    const { orgId } = await getOrgId(req, userId)
    if (orgId) {
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
  }

  // Legacy: company_profile matched by subdomain / custom_domain (no auth context)
  if (tenantHost) {
    let query = supabase.from('company_profile').select('*')
    const subdomain = extractSubdomain(tenantHost)
    if (subdomain) {
      query = query.eq('subdomain', subdomain)
    } else {
      query = query.eq('custom_domain', tenantHost)
    }
    const { data, error } = await query.maybeSingle()

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ company: data ?? null })
  }

  return NextResponse.json({ company: null })
}

export async function PATCH(req: NextRequest) {
  const supabase = createServiceClient()
  const body = (await req.json()) as Record<string, unknown>
  if ('phone' in body) {
    const r = normalizeOptionalPhoneField(body.phone)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
    if (r.value === undefined) delete body.phone
    else body.phone = r.value
  }

  const { userId } = await auth()
  const { orgId } = await getOrgId(req, userId ?? null)

  let existingQuery = supabase.from('company_profile').select('id')
  if (orgId) {
    existingQuery = existingQuery.eq('org_id', orgId)
  }

  const { data: existing } = await existingQuery.limit(1).single()

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
      .insert({ ...body, org_id: orgId ?? undefined })
      .select()
      .single())
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ company: data })
}
