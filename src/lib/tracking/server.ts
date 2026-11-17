/*
 * lib/tracking/server.ts
 *
 * Server side of the client photo feed: sign-in codes, which jobs a person may
 * see, and the feed itself.
 *
 * Photos are served to clients only as short-lived signed URLs, never the
 * stored public URL, so a link copied out of the feed stops working.
 */
import { timingSafeEqual } from 'crypto'
import twilio from 'twilio'
import { createServiceClient } from '@/lib/supabase'
import { formatToTwilioE164 } from '@/lib/phone'
import { generatePortalCode, hashPortalToken } from '@/lib/portalAuth'
import type { TradingNameId } from '@/lib/tradingNames'
import { groupPosts, isClientVisible, jobPhotoPath, type FeedPhotoFields } from '@/lib/tracking/feed'

type Supabase = ReturnType<typeof createServiceClient>

export const CODE_TTL_MINUTES = 15
const MAX_PER_IDENTITY_PER_HOUR = 5
const MAX_PER_IP_PER_HOUR = 20
const MAX_CODE_ATTEMPTS = 5
const SIGNED_URL_SECONDS = 2 * 60 * 60

/* ── Sign-in ─────────────────────────────────────────────────────────────── */

export async function isCodeRateLimited(supabase: Supabase, identity: string, ip: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const [byIdentity, byIp] = await Promise.all([
    supabase.from('tracking_login_codes').select('id', { count: 'exact', head: true }).eq('identity', identity).gte('created_at', since),
    ip
      ? supabase.from('tracking_login_codes').select('id', { count: 'exact', head: true }).eq('requested_ip', ip).gte('created_at', since)
      : Promise.resolve({ count: 0 }),
  ])
  return (byIdentity.count ?? 0) >= MAX_PER_IDENTITY_PER_HOUR || (byIp.count ?? 0) >= MAX_PER_IP_PER_HOUR
}

export async function issueCode(supabase: Supabase, identity: string, tradingName: TradingNameId, ip: string): Promise<string> {
  const code = generatePortalCode()
  const { error } = await supabase.from('tracking_login_codes').insert({
    identity,
    trading_name: tradingName,
    code_hash: hashPortalToken(code),
    expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
    requested_ip: ip,
  })
  if (error) throw new Error(error.message)
  return code
}

export type ConsumeResult = { ok: true } | { ok: false; reason: 'invalid' | 'expired' | 'locked' }

export async function consumeCode(
  supabase: Supabase,
  identity: string,
  tradingName: TradingNameId,
  code: string
): Promise<ConsumeResult> {
  const { data } = await supabase
    .from('tracking_login_codes')
    .select('id, code_hash, attempts, expires_at')
    .eq('identity', identity)
    .eq('trading_name', tradingName)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const row = data as { id: string; code_hash: string; attempts: number; expires_at: string } | null
  if (!row) return { ok: false, reason: 'invalid' }
  if (Date.parse(row.expires_at) < Date.now()) return { ok: false, reason: 'expired' }
  if (row.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, reason: 'locked' }

  const given = hashPortalToken(code)
  const match = given.length === row.code_hash.length && timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(row.code_hash, 'hex'))
  if (!match) {
    await supabase.from('tracking_login_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id)
    return { ok: false, reason: row.attempts + 1 >= MAX_CODE_ATTEMPTS ? 'locked' : 'invalid' }
  }
  const { data: burned } = await supabase
    .from('tracking_login_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('consumed_at', null)
    .select('id')
  return burned && burned.length ? { ok: true } : { ok: false, reason: 'invalid' }
}

export function codeFailureMessage(reason: 'invalid' | 'expired' | 'locked'): string {
  if (reason === 'expired') return 'That code has expired. Ask for a new one.'
  if (reason === 'locked') return 'Too many wrong tries. Ask for a new code.'
  return 'That code is not right. Check it and try again.'
}

/** Text a sign-in code. Throws when Twilio is not set up or rejects it. */
export async function textCode(mobile: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  const fromNum = process.env.TWILIO_PHONE_NUMBER?.trim()
  if (!(sid && authToken && fromNum)) throw new Error('Twilio is not set up')
  await twilio(sid, authToken).messages.create({ from: fromNum, to: mobile, body })
}

/** A text to the notify phone. Skipped when Twilio or the phone is not set up. Never throws. */
export async function notifyStaffSms(body: string): Promise<void> {
  const to = formatToTwilioE164(process.env.NOTIFY_PHONE?.trim())
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  const fromNum = process.env.TWILIO_PHONE_NUMBER?.trim()
  if (!(sid && authToken && fromNum && to)) return
  try {
    await twilio(sid, authToken).messages.create({ from: fromNum, to, body })
  } catch (err) {
    console.error('[tracking] staff sms failed', err)
  }
}

/* ── Who may see what ────────────────────────────────────────────────────── */

export interface ViewerJob {
  viewerId: string
  viewerName: string
  jobId: string
  orgId: string
  clientName: string
  siteAddress: string
}

interface ViewerJobRow {
  id: string
  name: string
  jobs: {
    id: string
    org_id: string
    client_name: string | null
    site_address: string | null
    trading_name: string | null
    client_feed_enabled: boolean
    archived_at: string | null
  } | null
}

/**
 * Jobs this person may see on this brand's host: they are a current viewer and
 * staff have turned the feed on. A job with no brand set shows on any host,
 * and every job shows on the shared host.
 */
export async function viewerJobs(
  supabase: Supabase,
  identity: string,
  tradingName: TradingNameId,
  anyBrand = false
): Promise<ViewerJob[]> {
  const select = 'id, name, jobs!inner(id, org_id, client_name, site_address, trading_name, client_feed_enabled, archived_at)'
  const column = identity.includes('@') ? 'email' : 'mobile'
  const { data } = await supabase.from('job_viewers').select(select).eq(column, identity).is('revoked_at', null)
  const seen = new Set<string>()
  const out: ViewerJob[] = []
  for (const row of (data ?? []) as unknown as ViewerJobRow[]) {
    const job = row.jobs
    if (!job || !job.client_feed_enabled || job.archived_at) continue
    if (!anyBrand && job.trading_name && job.trading_name !== tradingName) continue
    if (seen.has(job.id)) continue
    seen.add(job.id)
    out.push({
      viewerId: row.id,
      viewerName: row.name,
      jobId: job.id,
      orgId: job.org_id,
      clientName: (job.client_name ?? '').trim(),
      siteAddress: (job.site_address ?? '').trim(),
    })
  }
  return out
}

/* ── The feed ────────────────────────────────────────────────────────────── */

export const FEED_PHOTO_COLUMNS =
  'id, file_url, area_ref, category, capture_phase, taken_at, uploaded_at, client_visible, client_caption, cdr_load'

export interface FeedComment {
  id: string
  photo_id: string
  author_kind: 'client' | 'staff'
  author_name: string
  body: string
  created_at: string
}

export interface ClientFeedPost {
  id: string
  area: string
  at: string
  caption: string
  photos: { id: string; url: string }[]
  comments: FeedComment[]
}

export async function loadPhotos(supabase: Supabase, jobId: string): Promise<FeedPhotoFields[]> {
  const { data, error } = await supabase.from('photos').select(FEED_PHOTO_COLUMNS).eq('job_id', jobId)
  if (error) throw new Error(error.message)
  return (data ?? []) as FeedPhotoFields[]
}

export async function loadComments(supabase: Supabase, jobId: string): Promise<FeedComment[]> {
  const { data } = await supabase
    .from('job_feed_comments')
    .select('id, photo_id, author_kind, author_name, body, created_at')
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  return (data ?? []) as FeedComment[]
}

/** Comments sit on the post holding the photo they were pinned to. */
export function commentsByPost(posts: { id: string; photos: { id: string }[] }[], comments: FeedComment[]): Map<string, FeedComment[]> {
  const postOfPhoto = new Map<string, string>()
  for (const post of posts) for (const p of post.photos) postOfPhoto.set(p.id, post.id)
  const out = new Map<string, FeedComment[]>()
  for (const c of comments) {
    const postId = postOfPhoto.get(c.photo_id)
    if (!postId) continue
    const list = out.get(postId) ?? []
    list.push(c)
    out.set(postId, list)
  }
  return out
}

/** What the client sees: visible photos as posts, signed image links, comments. */
export async function clientFeed(supabase: Supabase, jobId: string): Promise<ClientFeedPost[]> {
  const [photos, comments] = await Promise.all([loadPhotos(supabase, jobId), loadComments(supabase, jobId)])
  const posts = groupPosts(photos.filter(isClientVisible))

  const paths = posts.flatMap(post => post.photos.map(p => jobPhotoPath(p.file_url))).filter((p): p is string => !!p)
  const signed = new Map<string, string>()
  if (paths.length) {
    const { data } = await supabase.storage.from('job-photos').createSignedUrls(paths, SIGNED_URL_SECONDS)
    for (const row of data ?? []) {
      if (row.path && row.signedUrl) signed.set(row.path, row.signedUrl)
    }
  }

  const byPost = commentsByPost(posts, comments)
  return posts
    .map(post => ({
      id: post.id,
      area: post.area,
      at: post.at,
      caption: post.caption,
      photos: post.photos
        .map(p => {
          const path = jobPhotoPath(p.file_url)
          return { id: p.id, url: (path && signed.get(path)) || '' }
        })
        .filter(p => p.url),
      comments: byPost.get(post.id) ?? [],
    }))
    .filter(post => post.photos.length)
}
