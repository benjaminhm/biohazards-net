/*
 * lib/calls/payload.ts
 *
 * Read a VoIP provider webhook into one shape. VoIPline (voipline.net.au)
 * sends unique_call_id, caller_id (caller CLI), dest_number (our number) and
 * call_start_at. Its user_number is the extension that rang, never the caller.
 * The recording link's field name is not documented, so any recording-looking
 * URL is accepted.
 * Other providers' common names are accepted too, one level into
 * `data` / `call` / `recording`. The raw payload is always stored as well.
 */
import { normalizeTwilioNumber } from '@/lib/phone'

export interface VoipCall {
  provider_call_id: string
  caller_number: string
  called_number: string
  started_at: string | null
  duration_s: number | null
  recording_url: string
  transcript: string
}

const KEYS = {
  id: ['unique_call_id', 'call_id', 'callId', 'call_uuid', 'callUuid', 'uuid', 'CallSid', 'call_sid', 'id'],
  caller: ['caller_id', 'caller_number', 'callerNumber', 'callerId', 'caller', 'from', 'From', 'cli', 'ani', 'source'],
  called: ['dest_number', 'called_number', 'calledNumber', 'to', 'To', 'did', 'dnis', 'destination', 'called'],
  started: ['call_start_at', 'started_at', 'startedAt', 'start_time', 'startTime', 'timestamp', 'call_start', 'date', 'created_at'],
  duration: ['duration_s', 'duration', 'call_duration', 'talk_time', 'Duration', 'RecordingDuration', 'billsec', 'length'],
  recording: [
    'recording_url', 'recordingUrl', 'RecordingUrl', 'record_url', 'recording_link', 'recording',
    'download_url', 'audio_url', 'audioUrl', 'file_url', 'fileUrl', 'media_url', 'link', 'url',
  ],
  transcript: ['transcript', 'transcription', 'transcript_text', 'TranscriptionText', 'text'],
} as const

/** Last resort: any URL in the payload that looks like a recording. */
function findRecordingUrl(obj: Record<string, unknown>): string {
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v) && /record|\.(mp3|wav|m4a|ogg)(\?|$)/i.test(v)) return v.trim()
  }
  return ''
}

const NESTED = ['data', 'call', 'payload', 'recording', 'event']

function flatten(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of NESTED) {
    const v = raw[key]
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, v as Record<string, unknown>)
  }
  return { ...out, ...raw }
}

function pick(obj: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

function text(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  return ''
}

function phone(v: unknown): string {
  const raw = text(v).replace(/[\s()-]/g, '')
  const t = /^61\d{9}$/.test(raw) ? `+${raw}` : raw
  return t ? normalizeTwilioNumber(t) ?? t : ''
}

function when(v: unknown): string | null {
  if (typeof v === 'number') {
    const ms = v < 1e12 ? v * 1000 : v
    return new Date(ms).toISOString()
  }
  const t = text(v)
  if (!t) return null
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function seconds(v: unknown): number | null {
  const n = Number(text(v))
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

function transcriptText(v: unknown): string {
  if (Array.isArray(v)) {
    return v
      .map(seg => {
        if (typeof seg === 'string') return seg
        if (seg && typeof seg === 'object') {
          const s = seg as Record<string, unknown>
          const who = text(s.speaker ?? s.channel ?? s.role)
          const said = text(s.text ?? s.transcript ?? s.content)
          return who ? `${who}: ${said}` : said
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return text(v)
}

export function parseVoipPayload(raw: Record<string, unknown>): VoipCall {
  const f = flatten(raw)
  const recording = pick(f, KEYS.recording)
  return {
    provider_call_id: text(pick(f, KEYS.id)),
    caller_number: phone(pick(f, KEYS.caller)),
    called_number: phone(pick(f, KEYS.called)),
    started_at: when(pick(f, KEYS.started)),
    duration_s: seconds(pick(f, KEYS.duration)),
    recording_url: /^https?:\/\//i.test(text(recording)) ? text(recording) : findRecordingUrl(f),
    transcript: transcriptText(pick(f, KEYS.transcript)),
  }
}

/** Form posts arrive as x-www-form-urlencoded; JSON posts as JSON. */
export async function readWebhookBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? ''
  if (type.includes('application/json')) {
    const body = await req.json().catch(() => null)
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  }
  const form = await req.formData().catch(() => null)
  if (!form) return {}
  const out: Record<string, unknown> = {}
  form.forEach((v, k) => {
    if (typeof v === 'string') out[k] = v
  })
  return out
}
