/*
 * app/api/company/equipment/route.ts
 *
 * Org-level equipment catalogue (company_profile.equipment_catalogue JSONB).
 *
 *   GET    /api/company/equipment            → { items: EquipmentCatalogueItem[] }
 *   POST   /api/company/equipment            → add one item                      → { item, items }
 *   PATCH  /api/company/equipment            → update one item (id required)     → { item, items }
 *   DELETE /api/company/equipment?id=…       → archive (soft-delete) one item    → { items }
 *
 * Items survive soft-delete as { archived: true } so historical job records
 * that referenced them still resolve the name/category. New jobs see only
 * non-archived rows via the checklist.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import type { EquipmentCategory, EquipmentCatalogueItem } from '@/lib/types'

const CATEGORIES: EquipmentCategory[] = [
  'ppe', 'containment', 'cleaning', 'air', 'tools', 'instruments', 'waste', 'other',
]

function slugId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'equip'
  return `${base}_${Math.random().toString(36).slice(2, 7)}`
}

async function loadProfile(orgId: string) {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('company_profile')
    .select('id, equipment_catalogue')
    .eq('org_id', orgId)
    .maybeSingle()
  return { data, error }
}

async function resolveOrg(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return { error: 'Unauthorized', status: 401 as const }
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return { error: 'No active organisation', status: 403 as const }
  return { orgId }
}

export async function GET(req: NextRequest) {
  const r = await resolveOrg(req)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })

  const { data, error } = await loadProfile(r.orgId)
  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const items = (data?.equipment_catalogue as EquipmentCatalogueItem[] | null) ?? []
  return NextResponse.json({ items })
}

async function writeCatalogue(
  orgId: string,
  profileId: string | null,
  items: EquipmentCatalogueItem[],
) {
  const supabase = createServiceClient()
  if (profileId) {
    const { error } = await supabase
      .from('company_profile')
      .update({ equipment_catalogue: items, updated_at: new Date().toISOString() })
      .eq('id', profileId)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase
      .from('company_profile')
      .insert({ org_id: orgId, equipment_catalogue: items })
    if (error) throw new Error(error.message)
  }
}

export async function POST(req: NextRequest) {
  const r = await resolveOrg(req)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    category?: string
    notes?: string
  }
  const name = (body.name ?? '').trim().slice(0, 80)
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const cat = (body.category ?? '').toLowerCase() as EquipmentCategory
  const category: EquipmentCategory = CATEGORIES.includes(cat) ? cat : 'other'
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 240) : ''

  const { data, error } = await loadProfile(r.orgId)
  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const existing = (data?.equipment_catalogue as EquipmentCatalogueItem[] | null) ?? []
  const nameTaken = existing.some(
    i => !i.archived && i.name.toLowerCase() === name.toLowerCase(),
  )
  if (nameTaken) {
    return NextResponse.json(
      { error: 'An active catalogue item with that name already exists.' },
      { status: 409 },
    )
  }

  const item: EquipmentCatalogueItem = {
    id: slugId(name),
    name,
    category,
    ...(notes ? { notes } : {}),
    created_at: new Date().toISOString(),
  }
  const items = [...existing, item]
  try {
    await writeCatalogue(r.orgId, data?.id ?? null, items)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Save failed' },
      { status: 500 },
    )
  }
  return NextResponse.json({ item, items })
}

export async function PATCH(req: NextRequest) {
  const r = await resolveOrg(req)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })

  const body = (await req.json().catch(() => ({}))) as {
    id?: string
    name?: string
    category?: string
    notes?: string
    archived?: boolean
  }
  const id = (body.id ?? '').trim()
  if (!id) return NextResponse.json({ error: 'Item id is required' }, { status: 400 })

  const { data, error } = await loadProfile(r.orgId)
  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const existing = (data?.equipment_catalogue as EquipmentCatalogueItem[] | null) ?? []
  const idx = existing.findIndex(i => i.id === id)
  if (idx < 0) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  const current = existing[idx]
  const next: EquipmentCatalogueItem = { ...current }
  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 80)
    if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    next.name = name
  }
  if (typeof body.category === 'string') {
    const cat = body.category.toLowerCase() as EquipmentCategory
    if (CATEGORIES.includes(cat)) next.category = cat
  }
  if (typeof body.notes === 'string') {
    const n = body.notes.trim().slice(0, 240)
    if (n) next.notes = n
    else delete next.notes
  }
  if (typeof body.archived === 'boolean') {
    if (body.archived) next.archived = true
    else delete next.archived
  }

  const items = [...existing]
  items[idx] = next
  try {
    await writeCatalogue(r.orgId, data?.id ?? null, items)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Save failed' },
      { status: 500 },
    )
  }
  return NextResponse.json({ item: next, items })
}

export async function DELETE(req: NextRequest) {
  const r = await resolveOrg(req)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Item id is required' }, { status: 400 })

  const { data, error } = await loadProfile(r.orgId)
  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const existing = (data?.equipment_catalogue as EquipmentCatalogueItem[] | null) ?? []
  const idx = existing.findIndex(i => i.id === id)
  if (idx < 0) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  const items = existing.map((i, ix) => (ix === idx ? { ...i, archived: true } : i))
  try {
    await writeCatalogue(r.orgId, data?.id ?? null, items)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Save failed' },
      { status: 500 },
    )
  }
  return NextResponse.json({ items })
}
