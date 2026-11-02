/*
 * GET  /api/records/sign-in — active people and whether they can sign in on the phone
 * POST /api/records/sign-in — add a technician and turn phone sign-in on
 * PATCH /api/records/sign-in — turn phone sign-in on or off
 *
 * Administrators only. Technicians never reach this route.
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { archivePerson, createTechnician, listPhoneSignIn, setPhoneSignIn } from '@/lib/phoneSignIn'

async function requireAdmin(req: Request): Promise<
  | { ok: true; orgId: string; supabase: ReturnType<typeof createServiceClient> }
  | { ok: false; response: NextResponse }
> {
  const { userId } = await auth()
  if (!userId) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const supabase = createServiceClient()
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return { ok: false, response: NextResponse.json({ error: 'No org' }, { status: 400 }) }

  const { data: me } = await supabase
    .from('org_users')
    .select('role')
    .eq('clerk_user_id', userId)
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle()
  if (!me || (me.role !== 'admin' && me.role !== 'owner')) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, orgId, supabase }
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.response
  const people = await listPhoneSignIn(gate.supabase, gate.orgId)
  return NextResponse.json({ people })
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.response

  let name = ''
  let email = ''
  try {
    const body = await req.json()
    name = typeof body?.name === 'string' ? body.name : ''
    email = typeof body?.email === 'string' ? body.email : ''
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const result = await createTechnician(gate.supabase, gate.orgId, name, email)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ person: result.person })
}

export async function PATCH(req: Request) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.response

  let personId = ''
  let enabled = false
  let archive = false
  try {
    const body = await req.json()
    personId = typeof body?.person_id === 'string' ? body.person_id : ''
    enabled = body?.enabled === true
    archive = body?.archive === true
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (!personId) return NextResponse.json({ error: 'Missing person.' }, { status: 400 })

  const result = archive
    ? await archivePerson(gate.supabase, gate.orgId, personId)
    : await setPhoneSignIn(gate.supabase, gate.orgId, personId, enabled)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ person: result.person })
}
