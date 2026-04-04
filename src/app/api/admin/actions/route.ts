/*
 * app/api/admin/actions/route.ts
 *
 * GET /api/admin/actions — returns a list of items requiring admin attention.
 *
 * This is a catch-all endpoint designed to grow. Currently returns:
 *   - incomplete_profile: team members missing phone, address, or email
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

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()

  // Get org_id for this admin
  const { data: orgUser } = await supabase
    .from('org_users')
    .select('org_id, role')
    .eq('clerk_user_id', userId)
    .single()

  if (!orgUser?.org_id) return NextResponse.json({ actions: [] })

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

  // ── Incomplete profiles ──────────────────────────────────────────────────
  // Team members missing phone, address, or email
  const { data: people } = await supabase
    .from('people')
    .select('id, name, phone, email, address')
    .eq('org_id', orgUser.org_id)
    .eq('status', 'active')

  for (const person of people ?? []) {
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

  return NextResponse.json({ actions })
}
