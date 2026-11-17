/*
 * app/api/jobs/[id]/client-feed/photos/route.ts
 *
 * PATCH — what the client sees of the job's photos.
 *   { photoId, visible: true | false | null } — show, hide, or back to the default rule
 *   { photoIds, caption } — the caption under a post: kept on its first photo,
 *                           cleared from the rest so the post has one caption
 */
import { NextResponse } from 'next/server'
import { gateStaffFeed } from '@/lib/tracking/staff'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gateStaffFeed(req, id)
  if (!g.ok) return g.response

  let body: { photoId?: unknown; visible?: unknown; photoIds?: unknown; caption?: unknown } = {}
  try {
    body = await req.json()
  } catch {}

  if (typeof body.photoId === 'string' && 'visible' in body) {
    const visible = body.visible
    if (visible !== true && visible !== false && visible !== null) {
      return NextResponse.json({ error: 'visible must be true, false or null' }, { status: 400 })
    }
    const { error } = await g.supabase.from('photos').update({ client_visible: visible }).eq('id', body.photoId).eq('job_id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (Array.isArray(body.photoIds) && typeof body.caption === 'string') {
    const ids = body.photoIds.filter((x): x is string => typeof x === 'string')
    if (!ids.length) return NextResponse.json({ error: 'photoIds is empty' }, { status: 400 })
    const caption = body.caption.trim().slice(0, 1000)
    const [lead, ...rest] = ids
    const { error } = await g.supabase.from('photos').update({ client_caption: caption }).eq('id', lead).eq('job_id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (rest.length) {
      await g.supabase.from('photos').update({ client_caption: '' }).in('id', rest).eq('job_id', id)
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
}
