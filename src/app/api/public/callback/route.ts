/*
 * app/api/public/callback/route.ts
 *
 * POST /api/public/callback — handles callback requests submitted via the
 * public company website (companyname.biohazards.net).
 *
 * Accepts: { name, phone, slug }
 * Looks up the org by slug to find NOTIFY_EMAIL target, then fires a
 * Resend email to the company's notification address.
 *
 * Fully public — no auth required. Rate limiting should be added if abuse
 * becomes an issue (Vercel edge rate limiting or a simple IP counter).
 * Always returns { ok: true } so the form never exposes internal errors.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  const { name, phone, slug } = await req.json()

  if (!name || !phone || !slug) {
    return NextResponse.json({ ok: true }) // silent — never expose validation to public
  }

  try {
    const supabase = createServiceClient()

    // Get org + company profile to find the notification email
    const { data: org } = await supabase
      .from('orgs')
      .select('id, name')
      .eq('slug', slug)
      .single()

    if (!org) return NextResponse.json({ ok: true })

    const { data: profile } = await supabase
      .from('company_profile')
      .select('name, email')
      .eq('org_id', org.id)
      .single()

    // Send to company email or platform NOTIFY_EMAIL fallback
    const toEmail = profile?.email || process.env.NOTIFY_EMAIL
    if (!toEmail) return NextResponse.json({ ok: true })

    const companyName = profile?.name ?? org.name

    await resend.emails.send({
      from: 'notifications@biohazards.net',
      to: toEmail,
      subject: `📞 Callback Request — ${name}`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
          <div style="background:#FF6B35;height:4px;border-radius:2px;margin-bottom:24px"></div>
          <h2 style="margin:0 0 4px;font-size:20px;color:#111">Callback Request</h2>
          <p style="margin:0 0 24px;color:#666;font-size:14px">
            Submitted via your website — ${companyName}
          </p>
          <table style="width:100%;border-collapse:collapse;font-size:15px">
            <tr>
              <td style="padding:10px 0;color:#888;width:80px">Name</td>
              <td style="padding:10px 0;color:#111;font-weight:600">${name}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;color:#888">Phone</td>
              <td style="padding:10px 0">
                <a href="tel:${phone}" style="color:#FF6B35;font-weight:700;font-size:18px;text-decoration:none">
                  ${phone}
                </a>
              </td>
            </tr>
          </table>
          <div style="margin-top:28px;padding:16px;background:#FFF7F4;border-left:3px solid #FF6B35;border-radius:4px;font-size:14px;color:#555">
            Call them back as soon as possible — fast response rates convert significantly higher.
          </div>
          <p style="margin-top:24px;font-size:12px;color:#bbb">biohazards.net</p>
        </div>
      `,
    })
  } catch (err) {
    console.error('Callback email failed:', err)
  }

  return NextResponse.json({ ok: true })
}
