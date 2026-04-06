/*
 * POST /api/webhooks/inbound-email
 *
 * Providers:
 *   - Mailgun (application/x-www-form-urlencoded): recipient, sender, subject, body-plain
 *   - Resend (application/json): { "type": "email.received", "data": { "email_id", "to", "from", ... } }
 *     Webhook has no body text — we GET https://api.resend.com/emails/receiving/:id with RESEND_API_KEY.
 *   - Manual JSON test: { recipient, sender, subject, text }
 *
 * Configure webhook URL in provider, e.g.:
 *   https://app.biohazards.net/api/webhooks/inbound-email?key=YOUR_INBOUND_WEBHOOK_SECRET
 *
 * Env: INBOUND_WEBHOOK_SECRET — required unless INBOUND_WEBHOOK_DEV=1 (local only).
 *      RESEND_API_KEY — required for Resend inbound content fetch.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

function verifySecret(req: Request): boolean {
  const secret = process.env.INBOUND_WEBHOOK_SECRET ?? ''
  if (!secret) {
    return process.env.INBOUND_WEBHOOK_DEV === '1'
  }
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ') && auth.slice(7) === secret) return true
  const url = new URL(req.url)
  if (url.searchParams.get('key') === secret) return true
  return false
}

function extractLocalPart(recipient: string): string {
  const at = recipient.indexOf('@')
  return (at === -1 ? recipient : recipient.slice(0, at)).trim().toLowerCase()
}

async function insertJobEmail(payload: {
  recipient: string
  sender: string
  subject: string
  text: string
}): Promise<{ ok: boolean; status: number; error?: string }> {
  const token = extractLocalPart(payload.recipient)
  if (!token) {
    return { ok: false, status: 400, error: 'Missing recipient' }
  }

  const supabase = createServiceClient()
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id, org_id')
    .eq('inbound_email_token', token)
    .maybeSingle()

  if (jobErr || !job) {
    return { ok: false, status: 404, error: 'Unknown recipient' }
  }

  const { error: insErr } = await supabase.from('job_email_messages').insert({
    org_id: job.org_id,
    job_id: job.id,
    direction: 'inbound',
    from_address: payload.sender.slice(0, 512),
    to_address: payload.recipient.slice(0, 512),
    subject: payload.subject ? payload.subject.slice(0, 998) : null,
    body_text: payload.text.slice(0, 500_000),
  })

  if (insErr) {
    console.error('[inbound-email]', insErr)
    return { ok: false, status: 500, error: insErr.message }
  }

  return { ok: true, status: 200 }
}

/** Resend: fetch full email after email.received webhook. */
async function handleResendEmailReceived(data: {
  email_id?: string
  to?: string[]
  from?: string
  subject?: string
}): Promise<NextResponse> {
  const emailId = data.email_id
  if (!emailId) {
    return NextResponse.json({ error: 'Missing email_id' }, { status: 400 })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })
  }

  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error('[inbound-email] Resend receiving API', res.status, errText)
    return NextResponse.json({ error: 'Failed to fetch email from Resend' }, { status: 502 })
  }

  const email = (await res.json()) as {
    to?: string[]
    from?: string
    subject?: string | null
    text?: string | null
    html?: string | null
  }

  const recipient = (data.to?.[0] ?? email.to?.[0] ?? '').trim()
  const sender = (data.from ?? email.from ?? 'unknown').trim()
  const subject = String(data.subject ?? email.subject ?? '')
  let text = (email.text ?? '').trim()
  if (!text && email.html) {
    text = email.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }

  const result = await insertJobEmail({
    recipient,
    sender,
    subject,
    text: text || '(no body)',
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Insert failed' }, { status: result.status })
  }
  return NextResponse.json({ ok: true, source: 'resend' })
}

export async function POST(req: Request) {
  if (!verifySecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawBody = await req.text()
  const ct = req.headers.get('content-type') ?? ''

  // Resend (Svix) sends JSON; type email.received
  if (ct.includes('application/json') && rawBody.trim().startsWith('{')) {
    try {
      const j = JSON.parse(rawBody) as { type?: string; data?: Record<string, unknown> }
      if (j.type === 'email.received' && j.data && typeof j.data === 'object') {
        const d = j.data as {
          email_id?: string
          to?: string[]
          from?: string
          subject?: string
        }
        return handleResendEmailReceived(d)
      }

      // Manual / dev JSON: full payload in one request
      const manual = JSON.parse(rawBody) as {
        recipient?: string
        sender?: string
        subject?: string
        text?: string
      }
      if (manual.recipient) {
        const result = await insertJobEmail({
          recipient: manual.recipient,
          sender: String(manual.sender ?? ''),
          subject: String(manual.subject ?? ''),
          text: String(manual.text ?? ''),
        })
        if (!result.ok) {
          return NextResponse.json({ error: result.error ?? 'Failed' }, { status: result.status })
        }
        return NextResponse.json({ ok: true, source: 'json' })
      }
    } catch (e) {
      console.error('[inbound-email] JSON parse', e)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
  }

  // Mailgun: form-urlencoded
  if (ct.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(rawBody)
    const payload = {
      recipient: String(params.get('recipient') ?? ''),
      sender: String(params.get('sender') ?? ''),
      subject: String(params.get('subject') ?? ''),
      text: String(params.get('stripped-text') ?? params.get('body-plain') ?? params.get('body') ?? ''),
    }
    const result = await insertJobEmail(payload)
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Failed' }, { status: result.status })
    }
    return NextResponse.json({ ok: true, source: 'mailgun' })
  }

  return NextResponse.json(
    { error: 'Use application/json (Resend / test) or application/x-www-form-urlencoded (Mailgun)' },
    { status: 400 }
  )
}
