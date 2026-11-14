/*
 * app/api/org/menu-archive/route.ts
 *
 * POST { keys: ['section:legal', 'tab:timeline'], archived: true | false }
 * Archives or restores job file menu items for the whole organisation (see
 * lib/menuArchive). Admins only. Returns the org's updated features.
 */
import { NextResponse } from 'next/server'
import { requireRecordAdmin } from '@/lib/recordsAuth'
import { applyMenuArchive, parseMenuKeys } from '@/lib/menuArchive'

export async function POST(req: Request) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const { orgId, supabase } = gate

  const body = (await req.json().catch(() => null)) as { keys?: unknown; archived?: unknown } | null
  const keys = parseMenuKeys(body?.keys)
  if (!keys || typeof body?.archived !== 'boolean') {
    return NextResponse.json({ error: 'Send keys (section:<id> or tab:<id>) and archived true or false' }, { status: 400 })
  }

  const { data: org, error: readError } = await supabase.from('orgs').select('features').eq('id', orgId).single()
  if (readError || !org) return NextResponse.json({ error: readError?.message ?? 'Organisation not found' }, { status: 500 })

  const features = applyMenuArchive(org.features as Record<string, unknown> | null, keys, body.archived)
  const { error } = await supabase.from('orgs').update({ features }).eq('id', orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ features })
}
