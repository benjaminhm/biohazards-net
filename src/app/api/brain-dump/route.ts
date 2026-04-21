/*
 * app/api/brain-dump/route.ts
 *
 * GET  /api/brain-dump  — list open + recently-done items for THIS admin
 *                         (scoped by org_id AND owner_user_id).
 * POST /api/brain-dump  — create a single item manually (no AI parse),
 *                         stamped with the caller as owner.
 *
 * Admin only (see lib/brainDump/guard). Per-user scoped — two admins in
 * the same org never see each other's items. Soft-delete rows are hidden.
 */
import { NextRequest, NextResponse } from 'next/server'
import { guardBrainDump } from '@/lib/brainDump/guard'
import { getClerkFirstName } from '@/lib/clerkDisplayName'

const ALLOWED_KINDS = ['todo', 'reminder', 'note', 'moment'] as const
type BrainDumpKind = (typeof ALLOWED_KINDS)[number]

const MAX_TEXT = 4000

export async function GET(req: NextRequest) {
  const guard = await guardBrainDump(req)
  if (!guard.ok) return guard.response
  const { userId, orgId, supabase } = guard.ctx

  const { data, error } = await supabase
    .from('brain_dump_items')
    .select('*')
    .eq('org_id', orgId)
    .eq('owner_user_id', userId)
    .is('deleted_at', null)
    .order('status', { ascending: true })
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: NextRequest) {
  const guard = await guardBrainDump(req)
  if (!guard.ok) return guard.response
  const { userId, orgId, supabase } = guard.ctx

  let body: {
    text?: string
    kind?: string
    due_at?: string | null
    priority?: number
    tags?: string[]
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const text = (body.text ?? '').trim()
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 })
  if (text.length > MAX_TEXT) {
    return NextResponse.json({ error: `text too long (max ${MAX_TEXT})` }, { status: 400 })
  }

  const kind: BrainDumpKind = ALLOWED_KINDS.includes(body.kind as BrainDumpKind)
    ? (body.kind as BrainDumpKind)
    : 'note'
  const priority = clampPriority(body.priority)
  const due_at = normaliseDueAt(body.due_at)
  const tags = Array.isArray(body.tags)
    ? body.tags.filter(t => typeof t === 'string').map(t => t.slice(0, 40)).slice(0, 12)
    : []

  const firstName = await getClerkFirstName(userId)

  const { data, error } = await supabase
    .from('brain_dump_items')
    .insert({
      org_id: orgId,
      owner_user_id: userId,
      capture_id: null,
      kind,
      status: 'open',
      text,
      due_at,
      priority,
      tags,
      created_by_user_id: userId,
      updated_by_user_id: userId,
      created_by_first_name: firstName,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data }, { status: 201 })
}

function clampPriority(v: unknown): 0 | 1 | 2 {
  const n = typeof v === 'number' ? v : 0
  if (n >= 2) return 2
  if (n >= 1) return 1
  return 0
}

function normaliseDueAt(v: unknown): string | null {
  if (!v || typeof v !== 'string') return null
  const t = new Date(v).getTime()
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString()
}
