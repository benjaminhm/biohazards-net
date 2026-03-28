import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET() {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ jobs: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { client_name, client_phone, client_email, site_address, job_type, urgency } = body

    if (!client_name || !site_address || !job_type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('jobs')
      .insert({
        client_name,
        client_phone: client_phone ?? '',
        client_email: client_email ?? '',
        site_address,
        job_type,
        urgency: urgency ?? 'standard',
        status: 'lead',
        notes: '',
        assessment_data: null,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ job: data }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
