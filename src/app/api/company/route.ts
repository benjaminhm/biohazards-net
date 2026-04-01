import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

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

  // Fall back to legacy subdomain / custom domain lookup
  let query = supabase.from('company_profile').select('*')

  if (tenantHost) {
    const subdomain = extractSubdomain(tenantHost)
    if (subdomain) {
      query = query.eq('subdomain', subdomain)
    } else {
      // Custom domain (e.g. app.brisbanebiohazardcleaning.com.au)
      query = query.eq('custom_domain', tenantHost)
    }
  }

  const { data, error } = await query.limit(1).single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ company: data ?? null })
}

export async function PATCH(req: NextRequest) {
  const supabase = createServiceClient()
  const body = await req.json()

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
