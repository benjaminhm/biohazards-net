/*
 * lib/tracking/feed.ts
 *
 * Which of a job's photos a client sees, and how they become posts.
 *
 * Default: during and after photos and anything captured as progress show;
 * assessment, untagged and disposal-record photos stay hidden. photos.client_visible
 * overrides that either way, set by staff on the Photos tab.
 *
 * A post is photos of the same area taken close together: each photo joins the
 * post before it when the area matches and it was taken within 30 minutes of
 * that post's last photo. Posts are worked out at read time, so a post's id is
 * the id of its first photo.
 */

export interface FeedPhotoFields {
  id: string
  file_url: string
  area_ref: string | null
  category: string | null
  capture_phase: string | null
  taken_at: string | null
  uploaded_at: string
  client_visible: boolean | null
  client_caption: string | null
  cdr_load: number | null
}

export interface FeedPost<T extends FeedPhotoFields> {
  id: string
  area: string
  at: string
  caption: string
  photos: T[]
}

export const POST_GAP_MS = 30 * 60 * 1000

export function defaultClientVisible(p: FeedPhotoFields): boolean {
  if (p.cdr_load != null) return false
  return p.category === 'during' || p.category === 'after' || p.capture_phase === 'progress'
}

export function isClientVisible(p: FeedPhotoFields): boolean {
  return p.client_visible ?? defaultClientVisible(p)
}

export function photoTime(p: FeedPhotoFields): string {
  return p.taken_at || p.uploaded_at
}

function areaKey(area: string | null): string {
  return (area ?? '').trim().toLowerCase()
}

/** Oldest first, grouped into posts. */
export function groupPosts<T extends FeedPhotoFields>(photos: T[]): FeedPost<T>[] {
  const sorted = [...photos].sort((a, b) => {
    const d = Date.parse(photoTime(a)) - Date.parse(photoTime(b))
    return d !== 0 ? d : a.id.localeCompare(b.id)
  })
  const posts: FeedPost<T>[] = []
  for (const photo of sorted) {
    const last = posts[posts.length - 1]
    const lastPhoto = last?.photos[last.photos.length - 1]
    if (
      last &&
      lastPhoto &&
      areaKey(lastPhoto.area_ref) === areaKey(photo.area_ref) &&
      Date.parse(photoTime(photo)) - Date.parse(photoTime(lastPhoto)) <= POST_GAP_MS
    ) {
      last.photos.push(photo)
      continue
    }
    posts.push({ id: photo.id, area: (photo.area_ref ?? '').trim(), at: photoTime(photo), caption: '', photos: [photo] })
  }
  for (const post of posts) {
    post.caption = post.photos.map(p => (p.client_caption ?? '').trim()).find(Boolean) ?? ''
  }
  return posts
}

/** Brisbane calendar day of an instant, e.g. "2026-11-16", for day headings. */
export function brisbaneDayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

export function brisbaneDayLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso))
}

export function brisbaneTimeLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

const PUBLIC_MARKER = '/object/public/job-photos/'

/** Object path inside the job-photos bucket, from the stored public URL. */
export function jobPhotoPath(fileUrl: string): string | null {
  const i = fileUrl.indexOf(PUBLIC_MARKER)
  if (i < 0) return null
  const path = decodeURIComponent(fileUrl.slice(i + PUBLIC_MARKER.length).split('?')[0])
  return path || null
}
