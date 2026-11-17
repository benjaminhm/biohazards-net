/*
 * app/api/jobs/[id]/client-feed/route.ts
 *
 * The job's client photo feed (tracking.<brand>.com.au), as staff manage it on
 * the Photos tab.
 *   GET   — on/off, viewers, people to suggest, and the feed as the client sees
 *           it, plus the photos the client does not see
 *   PATCH { enabled } — turn the feed on or off (admins and managers)
 */
import { NextResponse } from 'next/server'
import { isTradingNameId, trackingBaseUrl } from '@/lib/tradingNames'
import { groupPosts, isClientVisible, defaultClientVisible, type FeedPhotoFields } from '@/lib/tracking/feed'
import { commentsByPost, loadComments, loadPhotos } from '@/lib/tracking/server'
import { normaliseEmail, normaliseMobile } from '@/lib/tracking/identity'
import { gateStaffFeed } from '@/lib/tracking/staff'

function staffPhoto(p: FeedPhotoFields) {
  return {
    id: p.id,
    url: p.file_url,
    area: (p.area_ref ?? '').trim(),
    category: p.category ?? '',
    at: p.taken_at || p.uploaded_at,
    visible: isClientVisible(p),
    overridden: p.client_visible != null,
    defaultVisible: defaultClientVisible(p),
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gateStaffFeed(req, id)
  if (!g.ok) return g.response
  const { supabase, job } = g

  const [photos, comments, viewersRes, contactsRes] = await Promise.all([
    loadPhotos(supabase, id),
    loadComments(supabase, id),
    supabase
      .from('job_viewers')
      .select('id, name, mobile, email, added_by_name, last_seen_at, created_at')
      .eq('job_id', id)
      .is('revoked_at', null)
      .order('created_at', { ascending: true }),
    job.client_account_id
      ? supabase.from('client_account_contacts').select('name, phone, email, status').eq('account_id', job.client_account_id)
      : Promise.resolve({ data: [] as { name: string; phone: string; email: string; status: string }[] }),
  ])

  const viewers = (viewersRes.data ?? []) as { id: string; name: string; mobile: string; email: string }[]
  const known = new Set(viewers.flatMap(v => [v.mobile, v.email]).filter(Boolean))
  const suggestions: { name: string; mobile: string; email: string; source: string }[] = []
  const suggest = (name: string, phone: string | null, email: string | null, source: string) => {
    const mobile = normaliseMobile(phone ?? '') ?? ''
    const mail = normaliseEmail(email ?? '') ?? ''
    if (!mobile && !mail) return
    if ((mobile && known.has(mobile)) || (mail && known.has(mail))) return
    known.add(mobile || mail)
    suggestions.push({ name: name.trim(), mobile, email: mail, source })
  }
  suggest(job.client_name ?? '', job.client_phone, job.client_email, 'Client on the job')
  for (const c of (contactsRes.data ?? []) as { name: string; phone: string; email: string; status: string }[]) {
    if (c.status && c.status !== 'active') continue
    suggest(c.name, c.phone, c.email, 'Trade account contact')
  }

  const posts = groupPosts(photos.filter(isClientVisible))
  const byPost = commentsByPost(posts, comments)
  const hidden = photos
    .filter(p => !isClientVisible(p))
    .sort((a, b) => Date.parse(b.taken_at || b.uploaded_at) - Date.parse(a.taken_at || a.uploaded_at))

  return NextResponse.json({
    enabled: job.client_feed_enabled,
    canManage: g.canManage,
    trackingUrl: trackingBaseUrl(isTradingNameId(job.trading_name) ? job.trading_name : null),
    viewers: viewersRes.data ?? [],
    suggestions,
    posts: posts.map(post => ({
      id: post.id,
      area: post.area,
      at: post.at,
      caption: post.caption,
      photos: post.photos.map(staffPhoto),
      comments: byPost.get(post.id) ?? [],
    })),
    hidden: hidden.map(staffPhoto),
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gateStaffFeed(req, id, { manage: true })
  if (!g.ok) return g.response
  let body: { enabled?: unknown } = {}
  try {
    body = await req.json()
  } catch {}
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be true or false' }, { status: 400 })
  const { error } = await g.supabase.from('jobs').update({ client_feed_enabled: body.enabled }).eq('id', id).eq('org_id', g.orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ enabled: body.enabled })
}
