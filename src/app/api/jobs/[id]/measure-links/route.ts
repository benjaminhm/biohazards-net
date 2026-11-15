/*
 * app/api/jobs/[id]/measure-links/route.ts
 *
 * The job's phone room measure link (migration 081), shown as a QR code beside
 * the room list on the surface area cleaning quote.
 *   GET    — the link still open, if any
 *   POST   — the open link, or a new one (2 hours)
 *   DELETE — stop every open link for this job
 * Admins and managers only, the same as the phone upload link.
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/staffAuth'
import { getOrgId } from '@/lib/org'
import { createServiceClient } from '@/lib/supabase'
import { browserOrigin } from '@/lib/staffSession'
import { personShortCode } from '@/lib/phoneSignIn'
import { UPLOAD_LINK_TTL_MS, measureLinkUrl, newUploadToken, type UploadLinkRow } from '@/lib/photoUploadLink'

type Supabase = ReturnType<typeof createServiceClient>

async function gate(req: Request, jobId: string) {
  const { userId } = await auth()
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const supabase = createServiceClient()
  const { data: me } = await supabase
    .from('org_users')
    .select('role, person_id')
    .eq('clerk_user_id', userId)
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle()
  if (!me || !['admin', 'owner', 'manager'].includes(me.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const { data: job } = await supabase.from('jobs').select('id').eq('id', jobId).eq('org_id', orgId).maybeSingle()
  if (!job) return { error: NextResponse.json({ error: 'Job not found' }, { status: 404 }) }
  return { supabase, orgId, personId: (me.person_id as string | null) ?? null }
}

async function openLink(supabase: Supabase, jobId: string): Promise<UploadLinkRow | null> {
  const { data } = await supabase
    .from('room_measure_links')
    .select('*')
    .eq('job_id', jobId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as UploadLinkRow | null) ?? null
}

function present(req: Request, link: UploadLinkRow) {
  const origin = browserOrigin(req.url, req.headers.get('host'), req.headers.get('x-forwarded-proto'))
  return { link: { url: measureLinkUrl(link.token, origin), expires_at: link.expires_at, created_by_name: link.created_by_name } }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gate(req, id)
  if ('error' in g) return g.error
  const link = await openLink(g.supabase, id)
  return NextResponse.json(link ? present(req, link) : { link: null })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gate(req, id)
  if ('error' in g) return g.error
  const existing = await openLink(g.supabase, id)
  if (existing) return NextResponse.json(present(req, existing))

  let name = ''
  if (g.personId) {
    const { data: person } = await g.supabase.from('people').select('name').eq('id', g.personId).maybeSingle()
    name = `${(person?.name as string | undefined)?.trim() || 'Staff'} (${personShortCode(g.personId)})`
  }
  const { data, error } = await g.supabase
    .from('room_measure_links')
    .insert({
      token: newUploadToken(),
      org_id: g.orgId,
      job_id: id,
      created_by_person_id: g.personId,
      created_by_name: name || 'Room measure link',
      expires_at: new Date(Date.now() + UPLOAD_LINK_TTL_MS).toISOString(),
    })
    .select('*')
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Could not make the link' }, { status: 500 })
  return NextResponse.json(present(req, data as UploadLinkRow))
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gate(req, id)
  if ('error' in g) return g.error
  const { error } = await g.supabase
    .from('room_measure_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('job_id', id)
    .is('revoked_at', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
