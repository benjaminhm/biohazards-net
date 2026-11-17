/*
 * app/api/jobs/[id]/client-feed/comments/route.ts
 *
 * Staff replies on the client feed (admins and managers; team leads and
 * technicians can read comments but not reply).
 *   POST   { postId, body } — reply under a post, written by a person
 *   DELETE ?commentId= — remove a comment from the feed
 */
import { NextResponse } from 'next/server'
import { gateStaffFeed, staffName } from '@/lib/tracking/staff'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gateStaffFeed(req, id, { manage: true })
  if (!g.ok) return g.response

  let input: { postId?: unknown; body?: unknown } = {}
  try {
    input = await req.json()
  } catch {}
  const postId = typeof input.postId === 'string' ? input.postId : ''
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  if (!postId || !body) return NextResponse.json({ error: 'Write a reply first.' }, { status: 400 })
  if (body.length > 2000) return NextResponse.json({ error: 'Keep it under 2,000 characters.' }, { status: 400 })

  const { data: photo } = await g.supabase.from('photos').select('id').eq('id', postId).eq('job_id', id).maybeSingle()
  if (!photo) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const name = await staffName(g.supabase, g.orgId, g.userId)
  const { data, error } = await g.supabase
    .from('job_feed_comments')
    .insert({ org_id: g.orgId, job_id: id, photo_id: postId, author_kind: 'staff', author_name: name.split(/\s+/)[0] || '', body })
    .select('id, photo_id, author_kind, author_name, body, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ comment: data })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gateStaffFeed(req, id, { manage: true })
  if (!g.ok) return g.response
  const commentId = new URL(req.url).searchParams.get('commentId') ?? ''
  if (!commentId) return NextResponse.json({ error: 'commentId is required' }, { status: 400 })
  const { error } = await g.supabase
    .from('job_feed_comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', commentId)
    .eq('job_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
