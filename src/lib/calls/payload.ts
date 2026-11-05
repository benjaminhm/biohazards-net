/*
 * lib/calls/payload.ts
 *
 * Read a VoIP provider webhook into one shape. Field names differ between
 * providers (and Voiceline's are not pinned down yet), so this accepts the
 * common variants and looks one level into `data` / `call` / `recording`.
 * The raw payload is always stored as well, so nothing is lost if a field
 * is missed here.
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
  id: ['call_id', 'callId', 'call_uuid', 'callUuid', 'uuid', 'CallSid', 'call_sid', 'id'],
  caller: ['caller_number', 'callerNumber', 'caller_id', 'callerId', 'caller', 'from', 'From', 'cli', 'ani', 'source'],
  called: ['called_number', 'calledNumber', 'to', 'To', 'did', 'dnis', 'destination', 'called'],
  started: ['started_at', 'startedAt', 'start_time', 'startTime', 'timestamp', 'call_start', 'date', 'created_at'],
  duration: ['duration_s', 'duration', 'call_duration', 'Duration', 'RecordingDuration', 'billsec', 'length'],
  recording: ['recording_url', 'recordingUrl', 'RecordingUrl', 'recording', 'audio_url', 'audioUrl', 'file_url', 'fileUrl', 'media_url', 'url'],
  transcript: ['transcript', 'transcription', 'transcript_text', 'TranscriptionText', 'text'],
} as const

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
  const t = text(v)
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
    recording_url: /^https?:\/\//i.test(text(recording)) ? text(recording) : '',
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
