/*
 * app/api/people/[id]/invoices/route.ts
 *
 * GET  /api/people/[id]/invoices — list all invoices for a team member
 * POST /api/people/[id]/invoices — create a new invoice
 *
 * Auto-generates invoice_number as INV-001, INV-002, etc. per person.
 * Admin only.
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('subcontractor_invoices')
    .select('*, jobs(client_name, site_address, job_type)')
    .eq('person_id', id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invoices: data ?? [] })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = createServiceClient()

  // Get org_id from calling user
  const { data: orgUser } = await supabase
    .from('org_users').select('org_id, role')
    .eq('clerk_user_id', userId).single()

  if (!orgUser || orgUser.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Auto-generate invoice number (INV-001, INV-002…)
  const { count } = await supabase
    .from('subcontractor_invoices')
    .select('id', { count: 'exact', head: true })
    .eq('person_id', id)

  const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(3, '0')}`

  const body = await req.json()
  const { data, error } = await supabase
    .from('subcontractor_invoices')
    .insert({
      org_id:              orgUser.org_id,
      person_id:           id,
      job_id:              body.job_id ?? null,
      invoice_number:      invoiceNumber,
      works_undertaken:    body.works_undertaken ?? null,
      agreed_amount:       body.agreed_amount,
      bank_account_name:   body.bank_account_name ?? null,
      bank_bsb:            body.bank_bsb ?? null,
      bank_account_number: body.bank_account_number ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invoice: data }, { status: 201 })
}
