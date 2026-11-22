/*
 * app/api/org/menu-config/route.ts
 *
 * POST { sectionOrder?, tabOrder?, labels?, archivedKeys?, restoredKeys?, reset? }
 * Saves org-wide job file menu ordering, custom labels, and archived/restored items
 * into orgs.features. Admins only. Returns { features }.
 */
import { NextResponse } from 'next/server'
import { requireRecordAdmin } from '@/lib/recordsAuth'
import { applyMenuConfig, parseMenuConfigPatch } from '@/lib/menuConfig'

export async function POST(req: Request) {
  const gate = await requireRecordAdmin(req)
  if (!gate.ok) return gate.response
  const { orgId, supabase } = gate

  const body = await req.json().catch(() => null)
  const patch = parseMenuConfigPatch(body)
  if (!patch) {
    return NextResponse.json(
      { error: 'Invalid menu configuration payload.' },
      { status: 400 },
    )
  }

  const { data: org, error: readError } = await supabase
    .from('orgs')
    .select('features')
    .eq('id', orgId)
    .single()
  if (readError || !org) {
    return NextResponse.json(
      { error: readError?.message ?? 'Organisation not found' },
      { status: 500 },
    )
  }

  const features = applyMenuConfig(org.features as Record<string, unknown> | null, patch)
  const { error } = await supabase.from('orgs').update({ features }).eq('id', orgId)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ features })
}
