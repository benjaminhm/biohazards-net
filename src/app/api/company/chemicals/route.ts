/*
 * app/api/company/chemicals/route.ts
 *
 * Org-level chemicals catalogue (company_profile.chemicals_catalogue JSONB).
 * Mirrors /api/company/equipment with richer payload: each item carries
 * hazard classes, optional SDS storage path + parsed-SDS blob, manufacturer,
 * active ingredient, etc.
 *
 *   GET    /api/company/chemicals         → { items: ChemicalCatalogueItem[] }
 *   POST   /api/company/chemicals         → add one (optionally with parsed SDS) → { item, items }
 *   PATCH  /api/company/chemicals         → update one (id required)             → { item, items }
 *   DELETE /api/company/chemicals?id=…    → archive (soft-delete)                → { items }
 *
 * Like equipment, soft-deleted items remain in the JSONB so historical jobs
 * that referenced them still resolve. New jobs only see active rows.
 *
 * The SDS file itself lives in Supabase storage (`company-assets` bucket
 * under `sds/<orgId>/...`) — uploaded via /api/company/chemicals/parse-sds,
 * whose response payload is what the client POSTs here as `sds_parsed` +
 * `sds_path` + `sds_filename`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import type { ChemicalCatalogueItem, ChemicalHazardClass, SdsParsed } from '@/lib/types'

const HAZARD_CLASSES: ChemicalHazardClass[] = [
  'corrosive', 'flammable', 'toxic', 'oxidiser', 'biohazard',
  'irritant', 'health_hazard', 'environmental', 'compressed_gas', 'other',
]

function slugId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'chem'
  return `${base}_${Math.random().toString(36).slice(2, 7)}`
}

function sanitizeHazardClasses(raw: unknown): ChemicalHazardClass[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<ChemicalHazardClass>()
  for (const r of raw) {
    const c = String(r).toLowerCase() as ChemicalHazardClass
    if (HAZARD_CLASSES.includes(c)) out.add(c)
  }
  return Array.from(out)
}

function sanitizeParsed(raw: unknown): SdsParsed | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const product_name = typeof r.product_name === 'string' ? r.product_name.trim().slice(0, 120) : ''
  if (!product_name) return undefined
  const ppe = Array.isArray(r.ppe_required)
    ? r.ppe_required.map(x => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 20)
    : []
  const signal = r.signal_word === 'danger' || r.signal_word === 'warning' ? r.signal_word : null
  return {
    product_name,
    manufacturer: typeof r.manufacturer === 'string' ? r.manufacturer.trim().slice(0, 120) : undefined,
    active_ingredient: typeof r.active_ingredient === 'string' ? r.active_ingredient.trim().slice(0, 120) : undefined,
    hazard_classes: sanitizeHazardClasses(r.hazard_classes),
    signal_word: signal,
    ppe_required: ppe,
    first_aid_summary: typeof r.first_aid_summary === 'string' ? r.first_aid_summary.trim().slice(0, 600) : undefined,
    handling_precautions: typeof r.handling_precautions === 'string' ? r.handling_precautions.trim().slice(0, 600) : undefined,
    parsed_at: typeof r.parsed_at === 'string' ? r.parsed_at : new Date().toISOString(),
    source_filename: typeof r.source_filename === 'string' ? r.source_filename.slice(0, 120) : undefined,
  }
}

async function loadProfile(orgId: string) {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('company_profile')
    .select('id, chemicals_catalogue')
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

async function writeCatalogue(
  orgId: string,
  profileId: string | null,
  items: ChemicalCatalogueItem[],
) {
  const supabase = createServiceClient()
  if (profileId) {
    const { error } = await supabase
      .from('company_profile')
      .update({ chemicals_catalogue: items, updated_at: new Date().toISOString() })
      .eq('id', profileId)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase
      .from('company_profile')
      .insert({ org_id: orgId, chemicals_catalogue: items })
    if (error) throw new Error(error.message)
  }
}

export async function GET(req: NextRequest) {
  const r = await resolveOrg(req)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })

  const { data, error } = await loadProfile(r.orgId)
  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const items = (data?.chemicals_catalogue as ChemicalCatalogueItem[] | null) ?? []
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  const r = await resolveOrg(req)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    manufacturer?: string
    active_ingredient?: string
    hazard_classes?: string[]
    notes?: string
    sds_path?: string
    sds_filename?: string
    sds_parsed?: unknown
  }
  const name = (body.name ?? '').trim().slice(0, 80)
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const { data, error } = await loadProfile(r.orgId)
  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const existing = (data?.chemicals_catalogue as ChemicalCatalogueItem[] | null) ?? []
  const taken = existing.some(i => !i.archived && i.name.toLowerCase() === name.toLowerCase())
  if (taken) {
    return NextResponse.json(
      { error: 'An active catalogue item with that name already exists.' },
      { status: 409 },
    )
  }

  const item: ChemicalCatalogueItem = {
    id: slugId(name),
    name,
    hazard_classes: sanitizeHazardClasses(body.hazard_classes),
    created_at: new Date().toISOString(),
  }
  if (typeof body.manufacturer === 'string' && body.manufacturer.trim()) {
    item.manufacturer = body.manufacturer.trim().slice(0, 120)
  }
  if (typeof body.active_ingredient === 'string' && body.active_ingredient.trim()) {
    item.active_ingredient = body.active_ingredient.trim().slice(0, 120)
  }
  if (typeof body.notes === 'string' && body.notes.trim()) {
    item.notes = body.notes.trim().slice(0, 240)
  }
  if (typeof body.sds_path === 'string' && body.sds_path.trim()) {
    item.sds_path = body.sds_path.trim()
  }
  if (typeof body.sds_filename === 'string' && body.sds_filename.trim()) {
    item.sds_filename = body.sds_filename.trim().slice(0, 120)
  }
  const parsed = sanitizeParsed(body.sds_parsed)
  if (parsed) item.sds_parsed = parsed

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
    manufacturer?: string
    active_ingredient?: string
    hazard_classes?: string[]
    notes?: string
    sds_path?: string
    sds_filename?: string
    sds_parsed?: unknown
    clear_sds?: boolean
    archived?: boolean
  }
  const id = (body.id ?? '').trim()
  if (!id) return NextResponse.json({ error: 'Item id is required' }, { status: 400 })

  const { data, error } = await loadProfile(r.orgId)
  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const existing = (data?.chemicals_catalogue as ChemicalCatalogueItem[] | null) ?? []
  const idx = existing.findIndex(i => i.id === id)
  if (idx < 0) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  const next: ChemicalCatalogueItem = { ...existing[idx] }
  if (typeof body.name === 'string') {
    const n = body.name.trim().slice(0, 80)
    if (!n) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    next.name = n
  }
  if (typeof body.manufacturer === 'string') {
    const m = body.manufacturer.trim().slice(0, 120)
    if (m) next.manufacturer = m
    else delete next.manufacturer
  }
  if (typeof body.active_ingredient === 'string') {
    const a = body.active_ingredient.trim().slice(0, 120)
    if (a) next.active_ingredient = a
    else delete next.active_ingredient
  }
  if (Array.isArray(body.hazard_classes)) {
    next.hazard_classes = sanitizeHazardClasses(body.hazard_classes)
  }
  if (typeof body.notes === 'string') {
    const n = body.notes.trim().slice(0, 240)
    if (n) next.notes = n
    else delete next.notes
  }
  if (typeof body.sds_path === 'string') {
    const p = body.sds_path.trim()
    if (p) next.sds_path = p
  }
  if (typeof body.sds_filename === 'string') {
    const f = body.sds_filename.trim().slice(0, 120)
    if (f) next.sds_filename = f
  }
  if (body.sds_parsed !== undefined) {
    const parsed = sanitizeParsed(body.sds_parsed)
    if (parsed) next.sds_parsed = parsed
  }
  if (body.clear_sds === true) {
    delete next.sds_path
    delete next.sds_filename
    delete next.sds_parsed
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
  const existing = (data?.chemicals_catalogue as ChemicalCatalogueItem[] | null) ?? []
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
