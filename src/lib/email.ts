import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL!
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://biohazards-net.vercel.app'

export interface QuoteAcceptedData {
  jobId: string
  clientName: string
  siteAddress: string
  jobType: string
  reference: string
  total: number
}

export async function sendQuoteAcceptedEmail(data: QuoteAcceptedData) {
  const jobUrl = `${APP_URL}/jobs/${data.jobId}`
  const fmt = (n: number) => `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
      <div style="border-top: 4px solid #FF6B35; padding-top: 24px; margin-bottom: 32px;">
        <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #FF6B35; margin-bottom: 6px;">
          Brisbane Biohazard Cleaning
        </div>
        <h1 style="font-size: 24px; font-weight: 700; color: #111; margin: 0;">
          Quote Accepted ✓
        </h1>
      </div>

      <div style="background: #f9f9f9; border-radius: 10px; padding: 20px 24px; margin-bottom: 24px;">
        <div style="margin-bottom: 12px;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 2px;">Client</div>
          <div style="font-size: 16px; font-weight: 600; color: #111;">${data.clientName}</div>
        </div>
        <div style="margin-bottom: 12px;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 2px;">Site</div>
          <div style="font-size: 14px; color: #333;">${data.siteAddress}</div>
        </div>
        <div style="margin-bottom: 12px;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 2px;">Reference</div>
          <div style="font-size: 14px; color: #333;">${data.reference}</div>
        </div>
        <div>
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 2px;">Quote Total</div>
          <div style="font-size: 22px; font-weight: 700; color: #FF6B35;">${fmt(data.total)}</div>
        </div>
      </div>

      <div style="margin-bottom: 32px;">
        <p style="font-size: 14px; color: #555; line-height: 1.6; margin: 0;">
          Job status has been updated to <strong>Accepted</strong>.
          Ready to schedule — open the job to proceed.
        </p>
      </div>

      <a href="${jobUrl}" style="display: inline-block; background: #FF6B35; color: white; text-decoration: none; font-weight: 700; font-size: 15px; padding: 14px 28px; border-radius: 8px;">
        Open Job →
      </a>

      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #aaa;">
        Brisbane Biohazard Cleaning · biohazards.net
        <!-- TWILIO SMS: add SMS notification here when ready -->
      </div>
    </div>
  `

  await resend.emails.send({
    from: 'Brisbane Biohazard Cleaning <onboarding@resend.dev>',
    to: NOTIFY_EMAIL,
    subject: `Quote Accepted — ${data.clientName} — ${data.reference}`,
    html,
  })
}
