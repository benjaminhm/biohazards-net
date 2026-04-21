/*
 * app/api/brain-dump/[id]/route.ts
 *
 * PATCH  /api/brain-dump/[id]  — HITL edit of a single item
 *                                (text, kind, status, due_at, priority, tags).
 * DELETE /api/brain-dump/[id]  — HITL soft-delete (sets deleted_at + actor).
 *
 * Admin only, and every query is also filtered by owner_user_id so an
 * admin can never edit or delete another admin's item — even if they
 * guess the UUID.
 */
import { NextRequest, NextResponse } from 'next/server'
import { guardBrainDump } from '@/lib/brainDump/guard'

const ALLOWED_KINDS = ['todo', 'reminder', 'note', 'moment'] as const
const ALLOWED_STATUS = ['open', 'done', 'snoozed', 'archived'] as const
type BrainDumpKind = (typeof ALLOWED_KINDS)[number]
type BrainDumpStatus = (typeof ALLOWED_STATUS)[number]

const MAX_TEXT = 4000

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await guardBrainDump(req)
  if (!guard.ok) return guard.response
  const { userId, orgId, supabase } = guard.ctx

  const { id } = await params

  let body: {
    text?: string
    kind?: string
    status?: string
    due_at?: string | null
    priority?: number
    tags?: string[]
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {
    updated_by_user_id: userId,
    updated_at: new Date().toISOString(),
  }

  if (typeof body.text === 'string') {
    const text = body.text.trim()
    if (!text) return NextResponse.json({ error: 'text cannot be empty' }, { status: 400 })
    if (text.length > MAX_TEXT) {
      return NextResponse.json({ error: `text too long (max ${MAX_TEXT})` }, { status: 400 })
    }
    patch.text = text
  }

  if (typeof body.kind === 'string') {
    if (!(ALLOWED_KINDS as readonly string[]).includes(body.kind)) {
      return NextResponse.json({ error: 'invalid kind' }, { status: 400 })
    }
    patch.kind = body.kind as BrainDumpKind
  }

  if (typeof body.status === 'string') {
    if (!(ALLOWED_STATUS as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 })
    }
    patch.status = body.status as BrainDumpStatus
  }

  if ('due_at' in body) {
    if (body.due_at === null || body.due_at === '') {
      patch.due_at = null
    } else if (typeof body.due_at === 'string') {
      const t = new Date(body.due_at).getTime()
      if (!Number.isFinite(t)) {
        return NextResponse.json({ error: 'invalid due_at' }, { status: 400 })
      }
      patch.due_at = new Date(t).toISOString()
    }
  }

  if (typeof body.priority === 'number') {
    patch.priority = body.priority >= 2 ? 2 : body.priority >= 1 ? 1 : 0
  }

  if (Array.isArray(body.tags)) {
    patch.tags = body.tags
      .filter((t): t is string => typeof t === 'string')
      .map(t => t.trim().toLowerCase().slice(0, 40))
      .filter(Boolean)
      .slice(0, 12)
  }

  const { data, error } = await supabase
    .from('brain_dump_items')
    .update(patch)
    .eq('id', id)
    .eq('org_id', orgId)
    .eq('owner_user_id', userId)
    .is('deleted_at', null)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }
  return NextResponse.json({ item: data })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await guardBrainDump(req)
  if (!guard.ok) return guard.response
  const { userId, orgId, supabase } = guard.ctx

  const { id } = await params

  const { error } = await supabase
    .from('brain_dump_items')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: userId,
      updated_by_user_id: userId,
    })
    .eq('id', id)
    .eq('org_id', orgId)
    .eq('owner_user_id', userId)
    .is('deleted_at', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
