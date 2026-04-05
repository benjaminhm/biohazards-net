/*
 * app/api/admin/actions/route.ts
 *
 * GET /api/admin/actions — returns a list of items requiring admin attention.
 *
 * Current action types:
 *   - incomplete_profile: team members missing phone, address, or email
 *   - pending_invoice:    subcontractor invoices awaiting review (status=draft)
 *
 * Future action types to add here:
 *   - expiring_cert: certifications expiring within 30 days
 *   - unread_sms: inbound messages unread for > 2 hours
 *   - stale_lead: jobs in 'lead' status for > 48 hours
 *   - overdue_job: scheduled jobs with no status update
 *
 * Each action item: { type, title, description, href, severity }
 * severity: 'high' | 'medium' | 'low'
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { getOrgId } from '@/lib/org'

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()

  // Tenant from membership or platform impersonation (not raw org_users alone)
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ actions: [] })

  const actions: {
    type: string
    title: string
    description: string
    href: string
    severity: 'high' | 'medium' | 'low'
    person_id?: string
    person_email?: string | null
    person_phone?: string | null
    missing?: string[]
  }[] = []

  const [peopleRes, invoicesRes] = await Promise.all([
    // ── Incomplete profiles ──────────────────────────────────────────────────
    supabase
      .from('people')
      .select('id, name, phone, email, address')
      .eq('org_id', orgId)
      .eq('status', 'active'),

    // ── Pending (draft) subcontractor invoices ───────────────────────────────
    supabase
      .from('subcontractor_invoices')
      .select('id, invoice_number, agreed_amount, person_id, job_id, people(name), jobs(client_name)')
      .eq('org_id', orgId)
      .eq('status', 'draft')
      .order('created_at', { ascending: true }),
  ])

  // Incomplete profiles
  for (const person of peopleRes.data ?? []) {
    const missing: string[] = []
    if (!person.phone?.trim())   missing.push('phone')
    if (!person.email?.trim())   missing.push('email')
    if (!person.address?.trim()) missing.push('address')
    if (missing.length > 0) {
      actions.push({
        type:         'incomplete_profile',
        title:        person.name,
        description:  `Missing: ${missing.join(', ')}`,
        href:         `/team/${person.id}`,
        severity:     missing.length >= 2 ? 'high' : 'medium',
        person_id:    person.id,
        person_email: person.email ?? null,
        person_phone: person.phone ?? null,
        missing,
      })
    }
  }

  // Pending invoices
  for (const inv of invoicesRes.data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const personName = (inv.people as any)?.name ?? 'Unknown'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jobName    = (inv.jobs as any)?.client_name
    const amount     = `$${Number(inv.agreed_amount).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`
    actions.push({
      type:        'pending_invoice',
      title:       `Invoice ${inv.invoice_number} — ${personName}`,
      description: jobName ? `${amount} · ${jobName}` : amount,
      href:        `/team/${inv.person_id}?tab=invoices`,
      severity:    'low',
    })
  }

  return NextResponse.json({ actions })
}
