import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET() {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('company_profile')
    .select('*')
    .limit(1)
    .single()

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
