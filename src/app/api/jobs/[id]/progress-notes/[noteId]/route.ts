/*
 * PATCH  /api/jobs/[id]/progress-notes/[noteId]  — edit body/room, archive, unarchive
 * DELETE /api/jobs/[id]/progress-notes/[noteId]  — soft delete
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getClerkFirstName } from '@/lib/clerkDisplayName'

const MAX_BODY = 50_000

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organisation inactive or you have no active organisation' },
        { status: 403 }
      )
    }
    const { id: jobId, noteId } = await params
    const supabase = createServiceClient()

    const { data: existing, error: fetchErr } = await supabase
      .from('progress_notes')
      .select('*')
      .eq('id', noteId)
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!existing || existing.deleted_at) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    }

    const payload = (await req.json()) as {
      body?: string
      room?: string
      archived?: boolean
    }

    const first = await getClerkFirstName(userId)
    const now = new Date().toISOString()

    if (typeof payload.archived === 'boolean') {
      const { data, error } = await supabase
        .from('progress_notes')
        .update({
          archived_at: payload.archived ? now : null,
          archived_by_user_id: payload.archived ? userId : null,
          archived_by_first_name: payload.archived ? first : null,
          updated_at: now,
          updated_by_user_id: userId,
          updated_by_first_name: first,
        })
        .eq('id', noteId)
        .eq('org_id', orgId)
        .select()
        .single()
      if (error) throw error
      return NextResponse.json({ note: data })
    }

    const text = payload.body !== undefined ? String(payload.body).trim() : existing.body
    const room = payload.room !== undefined ? String(payload.room).trim() : existing.room
    if (!String(text).trim().length) {
      return NextResponse.json({ error: 'Note cannot be empty' }, { status: 400 })
    }
    if (text.length > MAX_BODY) {
      return NextResponse.json({ error: `Note must be at most ${MAX_BODY} characters` }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('progress_notes')
      .update({
        body: text,
        room,
        updated_at: now,
        updated_by_user_id: userId,
        updated_by_first_name: first,
      })
      .eq('id', noteId)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ note: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organisation inactive or you have no active organisation' },
        { status: 403 }
      )
    }
    const { id: jobId, noteId } = await params
    const supabase = createServiceClient()

    const { data: existing } = await supabase
      .from('progress_notes')
      .select('id')
      .eq('id', noteId)
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    }

    const first = await getClerkFirstName(userId)
    const now = new Date().toISOString()

    const { error } = await supabase
      .from('progress_notes')
      .update({
        deleted_at: now,
        deleted_by_user_id: userId,
        deleted_by_first_name: first,
        updated_at: now,
        updated_by_user_id: userId,
        updated_by_first_name: first,
      })
      .eq('id', noteId)
      .eq('org_id', orgId)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
