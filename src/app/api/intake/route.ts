// Public endpoint — used by /new-client intake form (no auth required)
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const {
      client_name,
      client_phone,
      client_email,
      site_address,
      job_type,
      organisation,
      position,
      situation,
      photo_urls,
    } = body

    if (!client_name?.trim() || !client_phone?.trim()) {
      return NextResponse.json({ error: 'Name and phone are required' }, { status: 400 })
    }

    // Build notes from all context fields
    const notesParts: string[] = []
    if (organisation?.trim()) notesParts.push(`Organisation: ${organisation.trim()}`)
    if (position?.trim())     notesParts.push(`Role: ${position.trim()}`)
    if (situation?.trim())    notesParts.push(`\n${situation.trim()}`)
    const notes = notesParts.length > 0 ? notesParts.join('\n') : '[Client enquiry via online form]'

    const supabase = createServiceClient()

    // Resolve org from subdomain header (set by middleware for all routes)
    const { orgId } = await getOrgId(req, null)

    const { data, error } = await supabase
      .from('jobs')
      .insert({
        client_name:   client_name.trim(),
        client_phone:  client_phone.trim(),
        client_email:  client_email?.trim() || null,
        site_address:  site_address?.trim() || null,
        job_type:      job_type || 'other',
        notes,
        urgency:       'standard',
        status:        'lead',
        org_id:        orgId || null,
      })
      .select()
      .single()

    if (error) throw error

    // Attach uploaded photos to the job
    if (Array.isArray(photo_urls) && photo_urls.length > 0 && data?.id) {
      const photoRows = photo_urls.map((url: string) => ({
        job_id:   data.id,
        org_id:   orgId || null,
        url,
        caption:  'Client intake photo',
      }))
      await supabase.from('photos').insert(photoRows)
    }

    // Fire notify-lead in background (non-blocking)
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
