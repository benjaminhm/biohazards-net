/*
 * lib/calls/recordingEmail.ts
 *
 * Call recordings that arrive by email. VoIPline's call recording object emails
 * each recording as an audio attachment; Resend receives it at the calls
 * address (INBOUND_CALLS_LOCAL@INBOUND_EMAIL_DOMAIN, default calls@…) and
 * /api/webhooks/inbound-email hands it here.
 *
 * Resend's attachment download links expire after an hour, so the call row
 * stores a resend:// reference and transcription asks Resend for a fresh link
 * each time it runs.
 *
 * Env: VOIP_DEFAULT_ORG_ID (org that owns emailed recordings), RESEND_API_KEY.
 */
import type { createServiceClient } from '@/lib/supabase'
import { normalizeTwilioNumber } from '@/lib/phone'

export const RESEND_REF_PREFIX = 'resend://'

export function callsInboxLocalPart(): string {
  return (process.env.INBOUND_CALLS_LOCAL ?? 'calls').trim().toLowerCase()
}

export interface EmailAttachment {
  id: string
  filename?: string | null
  content_type?: string | null
  size?: number | null
}

const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|oga|webm|mp4|mpeg|mpga|flac|aac)$/i

/** The largest audio attachment, by content type or file extension. */
export function pickRecording<T extends EmailAttachment>(attachments: T[]): T | null {
  const audio = attachments.filter(
    a => (a.content_type ?? '').toLowerCase().startsWith('audio/') || AUDIO_EXT.test(a.filename ?? ''),
  )
  if (audio.length === 0) return null
  return audio.reduce((best, a) => ((a.size ?? 0) > (best.size ?? 0) ? a : best))
}

const AU_NUMBER = /(?:\+?61[\s-]?|0)[2-478](?:[\s-]?\d){8}\b/g
const LABELLED = /(?:caller(?:\s*id)?|from|cli|calling\s+number)\s*[:#-]?\s*((?:\+?61[\s-]?|0)[2-478](?:[\s-]?\d){8})\b/i

function phone(raw: string): string {
  const t = raw.replace(/[\s-]/g, '')
  const e164 = t.startsWith('+') ? t : t.startsWith('61') ? `+${t}` : t
  return normalizeTwilioNumber(e164) ?? e164
}

/**
 * The caller's number from the email subject or body: a number labelled as the
 * caller wins; otherwise only a single distinct number is trusted, because the
 * dialled number may be in the email too.
 */
export function callerFromEmail(subject: string, body: string): string {
  const text = `${subject}\n${body}`
  const labelled = text.match(LABELLED)
  if (labelled) return phone(labelled[1])
  const found = new Set((text.match(AU_NUMBER) ?? []).map(n => n.replace(/[\s-]/g, '').replace(/^\+?61/, '0')))
  return found.size === 1 ? phone([...found][0]) : ''
}

export function resendRecordingRef(emailId: string, attachmentId: string): string {
  return `${RESEND_REF_PREFIX}${emailId}/${attachmentId}`
}

/** A fresh download link for a resend://<email>/<attachment> reference. */
export async function resolveResendRecording(ref: string): Promise<{ url: string; contentType: string; filename: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not set')
  const [emailId, attachmentId] = ref.slice(RESEND_REF_PREFIX.length).split('/')
  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const data = (await res.json().catch(() => ({}))) as {
    download_url?: string
    content_type?: string
    filename?: string
    message?: string
  }
  if (!res.ok || !data.download_url) throw new Error(`Resend attachment lookup failed: ${data.message ?? res.status}`)
  return { url: data.download_url, contentType: data.content_type ?? '', filename: data.filename ?? '' }
}

async function listAttachments(emailId: string, apiKey: string): Promise<EmailAttachment[]> {
  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}/attachments?limit=100`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const data = (await res.json().catch(() => ({}))) as { data?: EmailAttachment[]; message?: string }
  if (!res.ok) throw new Error(`Resend attachments list failed: ${data.message ?? res.status}`)
  return data.data ?? []
}

/**
 * Store an emailed recording as an inbound call. Returns the new call id, or
 * null when this email was already stored. An email with no audio is still
 * stored so it shows as failed on the Calls page.
 */
export async function storeRecordingEmail(supabase: ReturnType<typeof createServiceClient>, email: {
  emailId: string
  from: string
  to: string
  subject: string
  body: string
  receivedAt: string | null
}): Promise<string | null> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not set')
  const orgId = process.env.VOIP_DEFAULT_ORG_ID ?? ''
  if (!orgId) throw new Error('VOIP_DEFAULT_ORG_ID is not set')

  const attachments = await listAttachments(email.emailId, apiKey)
  const recording = pickRecording(attachments)

  const { data, error } = await supabase
    .from('inbound_calls')
    .upsert(
      {
        org_id: orgId,
        provider: 'voipline_email',
        provider_call_id: email.emailId,
        caller_number: callerFromEmail(email.subject, email.body),
        started_at: email.receivedAt,
        recording_url: recording ? resendRecordingRef(email.emailId, recording.id) : '',
        // Keys are prefixed so the payload reader never takes the email body for a transcript.
        payload_raw: {
          source: 'email',
          email_id: email.emailId,
          email_from: email.from,
          email_to: email.to,
          email_subject: email.subject,
          email_body: email.body.slice(0, 20_000),
          email_attachments: attachments.map(a => ({ id: a.id, filename: a.filename, content_type: a.content_type, size: a.size })),
        },
      },
      { onConflict: 'provider,provider_call_id', ignoreDuplicates: true },
    )
    .select('id')
  if (error) throw new Error(error.message)
  return (data?.[0]?.id as string | undefined) ?? null
}
