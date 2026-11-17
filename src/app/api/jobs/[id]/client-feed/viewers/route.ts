/*
 * app/api/jobs/[id]/client-feed/viewers/route.ts
 *
 * Who can sign in to follow this job's photos (admins and managers).
 *   POST   { name, mobile, email } — add a viewer; at least one of mobile or email
 *   DELETE ?viewerId= — remove a viewer; they lose access at once
 */
import { NextResponse } from 'next/server'
import { normaliseEmail, normaliseMobile } from '@/lib/tracking/identity'
import { gateStaffFeed, staffName } from '@/lib/tracking/staff'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gateStaffFeed(req, id, { manage: true })
  if (!g.ok) return g.response

  let body: { name?: unknown; mobile?: unknown; email?: unknown } = {}
  try {
    body = await req.json()
  } catch {}
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
  const rawMobile = typeof body.mobile === 'string' ? body.mobile.trim() : ''
  const rawEmail = typeof body.email === 'string' ? body.email.trim() : ''
  const mobile = rawMobile ? normaliseMobile(rawMobile) : ''
  const email = rawEmail ? normaliseEmail(rawEmail) : ''
  if (mobile === null) return NextResponse.json({ error: 'That is not an Australian mobile number (04…).' }, { status: 400 })
  if (email === null) return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 })
  if (!mobile && !email) return NextResponse.json({ error: 'Add a mobile number or an email address.' }, { status: 400 })

  const { data: existing } = await g.supabase
    .from('job_viewers')
    .select('id, mobile, email')
    .eq('job_id', id)
    .is('revoked_at', null)
  const clash = (existing ?? []).find(v => (mobile && v.mobile === mobile) || (email && v.email === email))
  if (clash) return NextResponse.json({ error: 'That person can already view this job.' }, { status: 409 })

  const { data, error } = await g.supabase
    .from('job_viewers')
    .insert({
      org_id: g.orgId,
      job_id: id,
      name,
      mobile,
      email,
      added_by_name: await staffName(g.supabase, g.orgId, g.userId),
    })
    .select('id, name, mobile, email, added_by_name, last_seen_at, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ viewer: data })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gateStaffFeed(req, id, { manage: true })
  if (!g.ok) return g.response
  const viewerId = new URL(req.url).searchParams.get('viewerId') ?? ''
  if (!viewerId) return NextResponse.json({ error: 'viewerId is required' }, { status: 400 })
  const { error } = await g.supabase
    .from('job_viewers')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', viewerId)
    .eq('job_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
