// Public endpoint — used by /new-client intake form (no auth required)
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const { client_name, client_phone, client_email, site_address, job_type, notes } = body

    if (!client_name?.trim() || !client_phone?.trim()) {
      return NextResponse.json({ error: 'Name and phone are required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('jobs')
      .insert({
        client_name:  client_name.trim(),
        client_phone: client_phone.trim(),
        client_email: client_email?.trim() || null,
        site_address: site_address?.trim() || null,
        job_type:     job_type || 'other',
        notes:        notes?.trim() || '[Client enquiry via online form]',
        urgency:      'standard',
        status:       'lead',
      })
      .select()
      .single()

    if (error) throw error

    // Fire notify-lead in the background (non-blocking)
    fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/notify-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {})

    return NextResponse.json({ job: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
