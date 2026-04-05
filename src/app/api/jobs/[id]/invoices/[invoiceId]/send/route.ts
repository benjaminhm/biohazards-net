/*
 * app/api/jobs/[id]/invoices/[invoiceId]/send/route.ts
 *
 * POST /api/jobs/[id]/invoices/[invoiceId]/send
 *
 * Subcontractor-facing: sends their own invoice to accounts. The invoice
 * must belong to the calling user's person record. Marks status as 'sent'.
 *
 * Sends a professional HTML email to ACCOUNTS_EMAIL (falls back to
 * NOTIFY_EMAIL) — same template as the admin-side send route.
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY!)
const FROM   = process.env.RESEND_FROM_NOTIFICATIONS || process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
const TO     = process.env.ACCOUNTS_EMAIL || process.env.NOTIFY_EMAIL!

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; invoiceId: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: jobId, invoiceId } = await params
  const supabase = createServiceClient()

  // Resolve the calling user's person_id
  const { data: orgUser } = await supabase
    .from('org_users')
    .select('org_id, person_id')
    .eq('clerk_user_id', userId)
    .single()

  if (!orgUser?.person_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { org_id, person_id } = orgUser

  // Fetch invoice — must belong to this person and this job
  const [{ data: invoice }, { data: person }, { data: company }] = await Promise.all([
    supabase
      .from('subcontractor_invoices')
      .select('*, jobs(client_name, site_address, job_type)')
      .eq('id', invoiceId)
      .eq('person_id', person_id)
      .eq('job_id', jobId)
      .single(),
    supabase.from('people').select('name, email').eq('id', person_id).single(),
    supabase.from('company_profile').select('name').eq('org_id', org_id).single(),
  ])

  if (!invoice || !person) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const companyName = company?.name ?? 'biohazards.net'
  const fmt = (n: number) => `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`
  const job = Array.isArray(invoice.jobs) ? invoice.jobs[0] : invoice.jobs

  const html = `
    <div style="font-family:-apple-system,system-ui,sans-serif;max-width:580px;margin:0 auto;padding:32px 24px;">

      <div style="border-top:4px solid #FF6B35;padding-top:24px;margin-bottom:32px;display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#FF6B35;margin-bottom:4px;">
            ${companyName}
          </div>
          <h1 style="font-size:26px;font-weight:800;color:#111;margin:0;letter-spacing:-0.02em;">Invoice</h1>
        </div>
        <div style="text-align:right;">
          <div style="font-size:20px;font-weight:800;color:#111;">${invoice.invoice_number}</div>
          <div style="font-size:12px;color:#888;margin-top:2px;">${new Date(invoice.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
        </div>
      </div>

      <div style="display:flex;gap:24px;margin-bottom:28px;">
        <div style="flex:1;background:#f9f9f9;border-radius:10px;padding:16px 18px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#999;margin-bottom:8px;">From</div>
          <div style="font-size:15px;font-weight:700;color:#111;">${person.name}</div>
          ${person.email ? `<div style="font-size:12px;color:#666;margin-top:2px;">${person.email}</div>` : ''}
        </div>
        ${job ? `
        <div style="flex:1;background:#f9f9f9;border-radius:10px;padding:16px 18px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#999;margin-bottom:8px;">Job</div>
          <div style="font-size:14px;font-weight:600;color:#111;">${job.client_name}</div>
          <div style="font-size:12px;color:#666;margin-top:2px;">${job.site_address ?? ''}</div>
        </div>` : ''}
      </div>

      ${invoice.works_undertaken ? `
      <div style="margin-bottom:24px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#999;margin-bottom:8px;">Works Undertaken</div>
        <div style="font-size:14px;color:#333;line-height:1.6;white-space:pre-wrap;">${invoice.works_undertaken}</div>
      </div>` : ''}

      <div style="background:#111;border-radius:10px;padding:20px 22px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:13px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:0.06em;">Amount Due</div>
        <div style="font-size:28px;font-weight:800;color:#FF6B35;letter-spacing:-0.02em;">${fmt(invoice.agreed_amount)}</div>
      </div>

      ${(invoice.bank_account_name || invoice.bank_bsb || invoice.bank_account_number) ? `
      <div style="border:1px solid #eee;border-radius:10px;padding:16px 18px;margin-bottom:28px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#999;margin-bottom:12px;">Payment Details</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          ${invoice.bank_account_name ? `<tr><td style="color:#888;padding:4px 0;width:120px;">Account Name</td><td style="font-weight:600;color:#111;">${invoice.bank_account_name}</td></tr>` : ''}
          ${invoice.bank_bsb ? `<tr><td style="color:#888;padding:4px 0;">BSB</td><td style="font-weight:600;color:#111;">${invoice.bank_bsb}</td></tr>` : ''}
          ${invoice.bank_account_number ? `<tr><td style="color:#888;padding:4px 0;">Account Number</td><td style="font-weight:600;color:#111;">${invoice.bank_account_number}</td></tr>` : ''}
        </table>
      </div>` : ''}

      <div style="margin-top:32px;padding-top:20px;border-top:1px solid #eee;font-size:11px;color:#bbb;">
        ${companyName} · biohazards.net
      </div>
    </div>
  `

  await resend.emails.send({
    from: `${companyName} <${FROM}>`,
    to: TO,
    subject: `Invoice ${invoice.invoice_number} — ${person.name} — ${fmt(invoice.agreed_amount)}`,
    html,
  })

  await supabase
    .from('subcontractor_invoices')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', invoiceId)

  return NextResponse.json({ ok: true })
}
