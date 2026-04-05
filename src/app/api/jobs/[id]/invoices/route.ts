/*
 * app/api/jobs/[id]/invoices/route.ts
 *
 * GET  /api/jobs/[id]/invoices
 *   Returns { invoices, can_invoice, bank_details } where:
 *     - can_invoice  true when caller is a subcontractor assigned to this job
 *     - bank_details person's saved bank account details for form pre-fill
 *
 * POST /api/jobs/[id]/invoices
 *   Creates a new invoice linked to this job. Enforces one invoice per
 *   person per job (409 if one already exists). After creation, sends an
 *   email notification to ADMIN_EMAIL (falls back to NOTIFY_EMAIL) and
 *   adds the item to the admin Action Required panel via the actions query.
 *
 * Only accessible to subcontractors assigned to the job.
 * Admins manage invoices from the team profile (/team/[id]?tab=invoices).
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY!)
const FROM   = process.env.RESEND_FROM_NOTIFICATIONS || process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
const ADMIN  = process.env.ADMIN_EMAIL || process.env.NOTIFY_EMAIL

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: jobId } = await params
  const supabase = createServiceClient()

  const { data: orgUser } = await supabase
    .from('org_users')
    .select('org_id, person_id')
    .eq('clerk_user_id', userId)
    .single()

  if (!orgUser) return NextResponse.json({ error: 'No org' }, { status: 403 })

  const { org_id, person_id } = orgUser

  if (!person_id) {
    return NextResponse.json({ invoices: [], can_invoice: false, bank_details: null })
  }

  const [assignmentRes, personRes] = await Promise.all([
    supabase
      .from('job_assignments')
      .select('id')
      .eq('job_id', jobId)
      .eq('person_id', person_id)
      .eq('org_id', org_id)
      .maybeSingle(),
    supabase
      .from('people')
      .select('role, bank_account_name, bank_bsb, bank_account_number')
      .eq('id', person_id)
      .single(),
  ])

  const can_invoice =
    !!assignmentRes.data && personRes.data?.role === 'subcontractor'

  const bank_details = personRes.data
    ? {
        bank_account_name:   personRes.data.bank_account_name ?? '',
        bank_bsb:            personRes.data.bank_bsb ?? '',
        bank_account_number: personRes.data.bank_account_number ?? '',
      }
    : null

  const { data: invoices } = await supabase
    .from('subcontractor_invoices')
    .select('*')
    .eq('person_id', person_id)
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })

  return NextResponse.json({ invoices: invoices ?? [], can_invoice, bank_details })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: jobId } = await params
  const supabase = createServiceClient()

  const { data: orgUser } = await supabase
    .from('org_users')
    .select('org_id, person_id')
    .eq('clerk_user_id', userId)
    .single()

  if (!orgUser?.person_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { org_id, person_id } = orgUser

  // Verify the caller is a subcontractor assigned to this job
  const [assignmentRes, personRes] = await Promise.all([
    supabase
      .from('job_assignments')
      .select('id')
      .eq('job_id', jobId)
      .eq('person_id', person_id)
      .eq('org_id', org_id)
      .maybeSingle(),
    supabase
      .from('people')
      .select('role, name, email')
      .eq('id', person_id)
      .single(),
  ])

  if (!assignmentRes.data || personRes.data?.role !== 'subcontractor') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // One invoice per person per job
  const { data: existing } = await supabase
    .from('subcontractor_invoices')
    .select('id')
    .eq('person_id', person_id)
    .eq('job_id', jobId)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: 'An invoice already exists for this job' },
      { status: 409 }
    )
  }

  const { count } = await supabase
    .from('subcontractor_invoices')
    .select('id', { count: 'exact', head: true })
    .eq('person_id', person_id)

  const invoice_number = `INV-${String((count ?? 0) + 1).padStart(3, '0')}`

  const body = await req.json()
  const { data: invoice, error } = await supabase
    .from('subcontractor_invoices')
    .insert({
      org_id,
      person_id,
      job_id:              jobId,
      invoice_number,
      works_undertaken:    body.works_undertaken ?? null,
      agreed_amount:       body.agreed_amount,
      bank_account_name:   body.bank_account_name ?? null,
      bank_bsb:            body.bank_bsb ?? null,
      bank_account_number: body.bank_account_number ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify admin — fire and forget
  if (ADMIN && invoice && personRes.data) {
    const { data: job } = await supabase
      .from('jobs')
      .select('client_name, site_address')
      .eq('id', jobId)
      .single()

    const { data: company } = await supabase
      .from('company_profile')
      .select('name')
      .eq('org_id', org_id)
      .single()

    const companyName = company?.name ?? 'biohazards.net'
    const fmt = (n: number) =>
      `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`

    resend.emails.send({
      from: `${companyName} <${FROM}>`,
      to: ADMIN,
      subject: `New invoice submitted — ${personRes.data.name} · ${invoice_number}`,
      html: `
        <div style="font-family:-apple-system,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
          <div style="border-top:4px solid #FF6B35;padding-top:20px;margin-bottom:24px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#FF6B35;margin-bottom:4px;">${companyName}</div>
            <h2 style="font-size:20px;font-weight:800;color:#111;margin:0;">New Invoice Submitted</h2>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
            <tr><td style="color:#888;padding:7px 0;width:130px;vertical-align:top;">From</td><td style="font-weight:600;color:#111;">${personRes.data.name}${personRes.data.email ? ` &lt;${personRes.data.email}&gt;` : ''}</td></tr>
            <tr><td style="color:#888;padding:7px 0;">Invoice</td><td style="font-weight:600;color:#111;">${invoice_number}</td></tr>
            <tr><td style="color:#888;padding:7px 0;">Amount</td><td style="font-weight:800;font-size:17px;color:#FF6B35;">${fmt(body.agreed_amount)}</td></tr>
            ${job ? `<tr><td style="color:#888;padding:7px 0;">Job</td><td style="font-weight:600;color:#111;">${job.client_name} · ${job.site_address}</td></tr>` : ''}
            ${body.works_undertaken ? `<tr><td style="color:#888;padding:7px 0;vertical-align:top;">Works</td><td style="color:#333;line-height:1.5;">${body.works_undertaken}</td></tr>` : ''}
          </table>
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/team/${person_id}?tab=invoices"
             style="display:inline-block;padding:12px 20px;background:#FF6B35;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">
            View Invoice →
          </a>
          <p style="margin-top:24px;font-size:12px;color:#bbb;">biohazards.net</p>
        </div>
      `,
    }).catch(err => console.error('Admin invoice notification failed:', err))
  }

  return NextResponse.json({ invoice }, { status: 201 })
}
