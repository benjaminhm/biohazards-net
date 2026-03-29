import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  const { client_name, client_phone, client_email, site_address, job_type, notes } = await req.json()

  try {
    await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: process.env.NOTIFY_EMAIL!,
      subject: `New Lead — ${client_name} — ${job_type.replace(/_/g, ' ')}`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
          <div style="background:#FF6B35;height:4px;border-radius:2px;margin-bottom:24px"></div>
          <h2 style="margin:0 0 4px;font-size:20px;color:#111">New Client Enquiry</h2>
          <p style="margin:0 0 24px;color:#666;font-size:14px">Submitted via app.biohazards.net/new-client</p>

          <table style="width:100%;border-collapse:collapse;font-size:14px">
            ${[
              ['Name', client_name],
              ['Phone', `<a href="tel:${client_phone}" style="color:#FF6B35">${client_phone}</a>`],
              ['Email', client_email ? `<a href="mailto:${client_email}" style="color:#FF6B35">${client_email}</a>` : '—'],
              ['Address', site_address || '—'],
              ['Job Type', job_type.replace(/_/g, ' ')],
              ['Notes', notes || '—'],
            ].map(([label, value]) => `
              <tr>
                <td style="padding:8px 0;color:#888;width:90px;vertical-align:top">${label}</td>
                <td style="padding:8px 0;color:#111;font-weight:500">${value}</td>
              </tr>
            `).join('')}
          </table>

          <div style="margin-top:24px;padding-top:20px;border-top:1px solid #eee">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}"
               style="display:inline-block;padding:12px 20px;background:#FF6B35;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">
              Open App →
            </a>
          </div>

          <p style="margin-top:20px;font-size:12px;color:#bbb">biohazards.net</p>
        </div>
      `,
    })
  } catch (err) {
    console.error('Lead notification email failed:', err)
  }

  return NextResponse.json({ ok: true })
}
