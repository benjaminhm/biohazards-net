/*
 * /api/payment-details — the bank account clients are told to pay into.
 *
 * GET  the saved details for the admin's organisation
 * PUT  { accountName, bsb, accountNumber } save them; all three empty clears them
 *
 * Admins and owners only, read and write. These details are shown to clients on
 * the pay step after they sign a quote, so changing them redirects where money
 * is sent: no other role can, and who changed them last is recorded.
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabase'
import { resolveActiveMembership } from '@/lib/membership'
import { loadBankDetails, saveBankDetails } from '@/lib/paymentDetails'
import { cleanBankDetails } from '@/lib/signing/pay'

const ADMIN_ROLES = new Set(['admin', 'owner'])

async function requireAdmin(): Promise<{ userId: string; orgId: string } | { response: NextResponse }> {
  const { userId } = await auth()
  if (!userId) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { membership } = await resolveActiveMembership(userId)
  if (!membership || !ADMIN_ROLES.has(membership.role)) {
    return { response: NextResponse.json({ error: 'Only admins can see or change payment details' }, { status: 403 }) }
  }
  return { userId, orgId: membership.org_id }
}

export async function GET() {
  const guard = await requireAdmin()
  if ('response' in guard) return guard.response
  const saved = await loadBankDetails(createServiceClient(), guard.orgId)
  return NextResponse.json({ details: saved.details, updatedAt: saved.updatedAt })
}

export async function PUT(req: Request) {
  const guard = await requireAdmin()
  if ('response' in guard) return guard.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const cleaned = cleanBankDetails(body)
  if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 })

  const supabase = createServiceClient()
  const result = await saveBankDetails(supabase, guard.orgId, cleaned.details, guard.userId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  const saved = await loadBankDetails(supabase, guard.orgId)
  return NextResponse.json({ details: saved.details, updatedAt: saved.updatedAt })
}
