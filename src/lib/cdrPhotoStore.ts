/*
 * Disposal record photo tags and image reads, shared by the staff routes
 * (/api/photos/cdr-*) and the PIN loader routes (/api/photo/bulk/cdr*).
 * Callers have already established which organisation is asking.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'
import { parseCdrPhotoRead } from '@/lib/disposalTimeline'
import type { CdrPhotoRead, CdrRole } from '@/lib/types'

export const CDR_PHOTO_COLUMNS =
  'id, job_id, file_url, caption, area_ref, category, uploaded_at, uploaded_by_name, taken_at, location_lat, location_lng, cdr_load, cdr_role, cdr_read'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ROLES: readonly string[] = ['load', 'dropoff', 'docket']
const MAX_TAGS = 600
const MAX_LOAD = 200
/** Anthropic accepts up to about 5 MB per image. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export interface CdrJob {
  id: string
  site_address: string
  site_lat: number | null
  site_lng: number | null
}

export async function cdrJobInOrg(supabase: SupabaseClient, jobId: string, orgId: string): Promise<CdrJob | null> {
  if (!UUID.test(jobId)) return null
  const { data } = await supabase
    .from('jobs')
    .select('id, site_address, site_lat, site_lng')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!data) return null
  return {
    id: data.id as string,
    site_address: (data.site_address as string | null) ?? '',
    site_lat: (data.site_lat as number | null) ?? null,
    site_lng: (data.site_lng as number | null) ?? null,
  }
}

interface TagRow { id: string; cdr_load: number | null; cdr_role: CdrRole | null }

/** Null when the body is not a list of tags. */
export function parseCdrTags(raw: unknown): TagRow[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TAGS) return null
  const rows: TagRow[] = []
  for (const item of raw) {
    const o = item && typeof item === 'object' ? (item as Record<string, unknown>) : null
    if (!o || typeof o.id !== 'string' || !UUID.test(o.id)) return null
    const load = o.load == null ? null : Number(o.load)
    if (load != null && (!Number.isInteger(load) || load < 0 || load > MAX_LOAD)) return null
    const role = o.role == null ? null : String(o.role)
    if (role != null && !ROLES.includes(role)) return null
    rows.push({ id: o.id, cdr_load: load, cdr_role: load == null ? null : (role as CdrRole | null) })
  }
  return rows
}

/** Save tags on photos of this job only. Returns the photos as they now stand. */
export async function saveCdrTags(supabase: SupabaseClient, jobId: string, rows: TagRow[]) {
  const BATCH = 10
  for (let i = 0; i < rows.length; i += BATCH) {
    const results = await Promise.all(rows.slice(i, i + BATCH).map(row =>
      supabase.from('photos').update({ cdr_load: row.cdr_load, cdr_role: row.cdr_role }).eq('id', row.id).eq('job_id', jobId),
    ))
    const failed = results.find(r => r.error)
    if (failed?.error) return { error: failed.error.message }
  }
  const { data, error } = await supabase
    .from('photos')
    .select(CDR_PHOTO_COLUMNS)
    .eq('job_id', jobId)
    .in('id', rows.map(r => r.id))
  if (error) return { error: error.message }
  return { photos: data ?? [] }
}

const SYSTEM = `You read one photo taken during a waste and contents removal job, for an internal disposal record. Staff check everything you return before it is used.

Reply with one JSON object and nothing else:
{"role": "", "container": "", "contents_type": "", "description": "", "weight_kg": null, "fee": null, "facility": ""}

role:
- "load": a ute tray, trailer, skip bin or truck holding waste or being filled, usually at a property.
- "dropoff": a load being tipped or emptied at a tip, transfer station or recycling yard, or a skip bin being collected.
- "docket": a weighbridge docket, tip receipt, tax invoice or disposal certificate.
- "other": anything else.

container (load and dropoff only): "ute", "trailer", "skip", "other", or "" when it cannot be seen.

contents_type (load and dropoff only), only when plain from the image, otherwise "":
"general" household or general waste, "mixed_cd" construction and demolition, "clinical", "asbestos", "sharps", "other".

description (load and dropoff only): one plain sentence of at most 15 words saying what can be seen in the load, for example "Mixed household furniture, mattresses and bagged rubbish." Describe objects only. Never describe people, and never guess at what cannot be seen. "" for a docket or other.

Docket only, each null or "" when it is not clearly legible. Never estimate a figure:
- weight_kg: net weight in kilograms (convert tonnes to kilograms).
- fee: total charged including GST, in dollars.
- facility: the name of the facility or company printed on the docket.`

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

function mediaType(url: string): ImageMediaType {
  const lower = url.split('?')[0].toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

/** Read one image. Throws with a message staff can act on when it cannot be read. */
export async function readCdrImage(fileUrl: string): Promise<CdrPhotoRead> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('Photo reading is not set up on this server.')
  const res = await fetch(fileUrl)
  if (!res.ok) throw new Error('Could not open the photo.')
  const bytes = await res.arrayBuffer()
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('The photo is too large to read.')

  const client = new Anthropic({ apiKey })
  const message = await client.messages.create({
    model: CLAUDE_SONNET_MODEL,
    max_tokens: 400,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType(fileUrl), data: Buffer.from(bytes).toString('base64') } },
        { type: 'text', text: 'Read this photo. JSON only.' },
      ],
    }],
  })
  const block = message.content[0]
  const text = block?.type === 'text' ? block.text : ''
  const json = text.match(/\{[\s\S]*\}/)
  let parsed: unknown = null
  try {
    parsed = json ? JSON.parse(json[0]) : null
  } catch {
    parsed = null
  }
  const read = parseCdrPhotoRead(parsed && typeof parsed === 'object' ? { ...parsed, read_at: new Date().toISOString() } : null)
  if (!read) throw new Error('The photo could not be read.')
  return read
}

/** Read a photo of this job once and keep the result on it. A photo already read is returned as it is. */
export async function readAndStoreCdrPhoto(supabase: SupabaseClient, jobId: string, photoId: string) {
  if (!UUID.test(photoId)) return { error: 'Photo not found.', status: 404 }
  const { data: photo } = await supabase
    .from('photos')
    .select(CDR_PHOTO_COLUMNS)
    .eq('id', photoId)
    .eq('job_id', jobId)
    .maybeSingle()
  if (!photo) return { error: 'Photo not found.', status: 404 }
  if (parseCdrPhotoRead(photo.cdr_read)) return { photo }
  let read: CdrPhotoRead
  try {
    read = await readCdrImage(photo.file_url as string)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The photo could not be read.', status: 502 }
  }
  const { data: saved, error } = await supabase
    .from('photos')
    .update({ cdr_read: read })
    .eq('id', photoId)
    .eq('job_id', jobId)
    .select(CDR_PHOTO_COLUMNS)
    .single()
  if (error) return { error: error.message, status: 500 }
  return { photo: saved }
}
