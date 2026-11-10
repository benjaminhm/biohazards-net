/*
 * /api/photo/notes/[id] — change or remove a note written with this photo PIN.
 *
 *   PATCH  { body }   replaces the text
 *   DELETE            soft delete (deleted_at), the same as the Progress Notes tab
 *
 * Only the person who wrote the note can change it here.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { photoBulkPerson } from '@/lib/photoBulkSession'
import { NOTE_MAX_CHARS, openJobForPin, pinAuthorId, pinAuthorName } from '@/lib/photoNotes'
import type { PinPerson } from '@/lib/photoPin'

type Supabase = ReturnType<typeof createServiceClient>

async function ownNote(supabase: Supabase, id: string, person: PinPerson): Promise<boolean> {
  const { data } = await supabase
    .from('progress_notes')
    .select('id, job_id')
    .eq('id', id)
    .eq('org_id', person.org_id)
    .eq('created_by_user_id', pinAuthorId(person))
    .is('deleted_at', null)
    .maybeSingle()
  if (!data) return false
  return openJobForPin(supabase, data.job_id as string, person.org_id)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const person = await photoBulkPerson(req)
  if (!person) return NextResponse.json({ error: 'Signed out. Enter your PIN again.' }, { status: 401 })
  const { id } = await params

  const body = (await req.json().catch(() => ({}))) as { body?: unknown }
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) return NextResponse.json({ error: 'Note cannot be empty.' }, { status: 400 })
  if (text.length > NOTE_MAX_CHARS) return NextResponse.json({ error: 'Note is too long.' }, { status: 400 })

  const supabase = createServiceClient()
  if (!(await ownNote(supabase, id, person))) return NextResponse.json({ error: 'Note not found.' }, { status: 404 })

  const { data, error } = await supabase
    .from('progress_notes')
    .update({
      body: text,
      updated_at: new Date().toISOString(),
      updated_by_user_id: pinAuthorId(person),
      updated_by_first_name: pinAuthorName(person),
    })
    .eq('id', id)
    .select('id, body, created_at, updated_at')
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Could not save the note.' }, { status: 500 })

  return NextResponse.json({
    note: {
      kind: 'note',
      id: data.id as string,
      body: data.body as string,
      at: data.created_at as string,
      updated_at: data.updated_at as string,
      by: pinAuthorName(person),
      mine: true,
    },
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const person = await photoBulkPerson(req)
  if (!person) return NextResponse.json({ error: 'Signed out. Enter your PIN again.' }, { status: 401 })
  const { id } = await params

  const supabase = createServiceClient()
  if (!(await ownNote(supabase, id, person))) return NextResponse.json({ error: 'Note not found.' }, { status: 404 })

  const { error } = await supabase
    .from('progress_notes')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: pinAuthorId(person),
      deleted_by_first_name: pinAuthorName(person),
    })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
