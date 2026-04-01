import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  const { email, name, message, intakeUrl: clientIntakeUrl } = await req.json()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  // Use the URL passed from the client (which is the current subdomain)
  const intakeUrl = clientIntakeUrl ?? `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://brisbanebiohazardcleaning.biohazards.net'}/new-client`
  const greeting = name ? `Hi ${name},` : 'Hi,'

  await resend.emails.send({
    from: 'onboarding@resend.dev',
    to: email,
    subject: 'Please fill in your details — Brisbane Biohazard Cleaning',
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <p style="font-size:16px;color:#111;margin:0 0 16px">${greeting}</p>
        <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 24px">${message}</p>
        <a href="${intakeUrl}"
           style="display:inline-block;padding:14px 24px;background:#FF6B35;color:#fff;
                  text-decoration:none;border-radius:8px;font-weight:700;font-size:15px">
          Fill In Your Details →
        </a>
        <p style="margin-top:24px;font-size:13px;color:#888">
          Or copy this link: <a href="${intakeUrl}" style="color:#FF6B35">${intakeUrl}</a>
        </p>
        <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
        <p style="font-size:12px;color:#bbb;margin:0">Brisbane Biohazard Cleaning</p>
      </div>
    `,
  })

  return NextResponse.json({ ok: true })
}
