import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

function extractSubdomain(host: string): string | null {
  // brisbanebiohazardcleaning.biohazards.net → brisbanebiohazardcleaning
  // app.brisbanebiohazardcleaning.com.au → null (custom domain lookup instead)
  const bhMatch = host.match(/^([^.]+)\.biohazards\.net$/)
  return bhMatch ? bhMatch[1] : null
}

export async function GET(req: NextRequest) {
  const supabase = createServiceClient()
  const tenantHost = req.headers.get('x-tenant-host')

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

export async function PATCH(req: Request) {
  const supabase = createServiceClient()
  const body = await req.json()

  // Get existing row id
  const { data: existing } = await supabase
    .from('company_profile')
    .select('id')
    .limit(1)
    .single()

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
      .insert({ ...body })
      .select()
      .single())
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ company: data })
}
