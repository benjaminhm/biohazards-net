/*
 * app/api/tracking/jobs/[jobId]/comments/route.ts
 *
 * POST { postId, body } — a client comment on one post. The post must be one
 * the client can see. The notify phone gets a text so an admin can reply from
 * the job's Photos tab; nothing answers automatically.
 */
import { NextResponse } from 'next/server'
import { gateViewer } from '@/lib/tracking/route'
import { groupPosts, isClientVisible } from '@/lib/tracking/feed'
import { loadPhotos, notifyStaffSms } from '@/lib/tracking/server'

const MAX_COMMENTS_PER_HOUR = 30

function jobUrl(jobId: string): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net').replace(/\/+$/, '')}/jobs/${jobId}`
}

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const g = await gateViewer(req)
  if (!g.ok) return g.response
  const job = g.jobs.find(j => j.jobId === jobId)
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let input: { postId?: unknown; body?: unknown } = {}
  try {
    input = await req.json()
  } catch {}
  const postId = typeof input.postId === 'string' ? input.postId : ''
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  if (!body) return NextResponse.json({ error: 'Write a comment first.' }, { status: 400 })
  if (body.length > 2000) return NextResponse.json({ error: 'Keep it under 2,000 characters.' }, { status: 400 })

  const posts = groupPosts((await loadPhotos(g.supabase, jobId)).filter(isClientVisible))
  const post = posts.find(p => p.photos.some(ph => ph.id === postId))
  if (!post) return NextResponse.json({ error: 'That post is no longer shown.' }, { status: 404 })

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count } = await g.supabase
    .from('job_feed_comments')
    .select('id', { count: 'exact', head: true })
    .eq('viewer_id', job.viewerId)
    .gte('created_at', since)
  if ((count ?? 0) >= MAX_COMMENTS_PER_HOUR) {
    return NextResponse.json({ error: 'Too many comments in an hour. Try again later.' }, { status: 429 })
  }

  const { data, error } = await g.supabase
    .from('job_feed_comments')
    .insert({
      org_id: job.orgId,
      job_id: jobId,
      photo_id: post.id,
      author_kind: 'client',
      viewer_id: job.viewerId,
      author_name: job.viewerName,
      body,
    })
    .select('id, photo_id, author_kind, author_name, body, created_at')
    .single()
  if (error) return NextResponse.json({ error: 'The comment could not be saved.' }, { status: 500 })

  const who = job.viewerName || 'A client'
  const where = job.siteAddress || job.clientName
  const excerpt = body.length > 140 ? `${body.slice(0, 137)}…` : body
  await notifyStaffSms(`Photo comment from ${who}${where ? ` — ${where}` : ''}: "${excerpt}" Reply on the Photos tab: ${jobUrl(jobId)}`)

  return NextResponse.json({ comment: data })
}
