/*
 * lib/calls/recordingEmail.ts
 *
 * Call recordings that arrive by email. VoIPline's call recording object emails
 * each recording as an audio attachment; Resend receives it at the calls
 * address (INBOUND_CALLS_LOCAL@INBOUND_EMAIL_DOMAIN, default calls@…) and
 * /api/webhooks/inbound-email hands it here.
 *
 * Long calls arrive as several emails (…-part001.mp3, …-part002.mp3) sharing
 * one "Unique call ID"; they become one call with its parts in order.
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

/** VoIPline names parts "…-part001.mp3"; a file without a part number is part 1. */
export function partNumber(filename: string): number {
  const m = /part[\s_-]?(\d+)/i.exec(filename)
  return m ? Number(m[1]) : 1
}

/** The audio attachments, in part order. */
export function audioAttachments<T extends EmailAttachment>(attachments: T[]): T[] {
  return attachments
    .filter(a => (a.content_type ?? '').toLowerCase().startsWith('audio/') || AUDIO_EXT.test(a.filename ?? ''))
    .sort((a, b) => partNumber(a.filename ?? '') - partNumber(b.filename ?? '') || (a.filename ?? '').localeCompare(b.filename ?? ''))
}

/** VoIPline's "Unique call ID: 5031793910305256", shared by every part of one call. */
export function uniqueCallId(body: string): string {
  return /unique\s+call\s+id\s*[:#-]?\s*([\w.-]+)/i.exec(body)?.[1] ?? ''
}

export interface RecordingPart {
  ref: string
  filename: string
  part: number
  email_id: string
}

/** Refs to transcribe, in part order then arrival order. */
export function orderedRecordingRefs(parts: RecordingPart[], fallbackUrl: string): string[] {
  if (!parts.length) return fallbackUrl ? [fallbackUrl] : []
  return parts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.part - b.p.part || a.i - b.i)
    .map(({ p }) => p.ref)
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
 * Store an emailed recording as an inbound call. Emails that share VoIPline's
 * Unique call ID are parts of one call and add their audio to it. Returns the
 * call id and its part count, or null when this email was already stored. An
 * email with no audio is still stored so it shows as failed on the Calls page.
 */
export async function storeRecordingEmail(supabase: ReturnType<typeof createServiceClient>, email: {
  emailId: string
  from: string
  to: string
  subject: string
  body: string
  receivedAt: string | null
}): Promise<{ callId: string; partCount: number } | null> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not set')
  const orgId = process.env.VOIP_DEFAULT_ORG_ID ?? ''
  if (!orgId) throw new Error('VOIP_DEFAULT_ORG_ID is not set')

  const attachments = await listAttachments(email.emailId, apiKey)
  const parts: RecordingPart[] = audioAttachments(attachments).map(a => ({
    ref: resendRecordingRef(email.emailId, a.id),
    filename: a.filename ?? '',
    part: partNumber(a.filename ?? ''),
    email_id: email.emailId,
  }))
  const callKey = uniqueCallId(email.body)

  const { data, error } = await supabase
    .from('inbound_calls')
    .upsert(
      {
        org_id: orgId,
        provider: 'voipline_email',
        provider_call_id: callKey || email.emailId,
        caller_number: callerFromEmail(email.subject, email.body),
        started_at: email.receivedAt,
        recording_url: parts[0]?.ref ?? '',
        // Keys are prefixed so the payload reader never takes the email body for a transcript.
        payload_raw: {
          source: 'email',
          unique_call_id: callKey,
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

  let callId = data?.[0]?.id as string | undefined
  const created = Boolean(callId)
  if (!callId) {
    const { data: existing } = await supabase
      .from('inbound_calls')
      .select('id, recording_parts')
      .eq('provider', 'voipline_email')
      .eq('provider_call_id', callKey || email.emailId)
      .maybeSingle()
    if (!existing) throw new Error('Call row missing after upsert')
    const known = new Set(((existing.recording_parts ?? []) as RecordingPart[]).map(p => p.ref))
    if (parts.every(p => known.has(p.ref))) return null
    callId = existing.id as string
  }
  if (!parts.length) return created ? { callId, partCount: 0 } : null

  const { data: count, error: appendErr } = await supabase.rpc('append_call_recording_parts', {
    p_call_id: callId,
    p_parts: parts,
  })
  if (appendErr) throw new Error(appendErr.message)
  return { callId, partCount: Number(count ?? parts.length) }
}
