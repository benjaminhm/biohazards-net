/*
 * /api/photo/notes — the job notepad (notes.biohazards.net), signed in with a photo PIN.
 *
 *   GET  ?job_id=…        the job's notes and photos, oldest first
 *   POST { job_id, body, written_at? }   adds a progress note credited to the PIN person
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { photoBulkPerson } from '@/lib/photoBulkSession'
import {
  NOTE_MAX_CHARS,
  noteWrittenAt,
  openJobForPin,
  pinAuthorId,
  pinAuthorName,
  sortPad,
  type PadItem,
} from '@/lib/photoNotes'

const LIMIT = 500

export async function GET(req: Request) {
  const person = await photoBulkPerson(req)
  if (!person) return NextResponse.json({ error: 'Signed out. Enter your PIN again.' }, { status: 401 })

  const jobId = new URL(req.url).searchParams.get('job_id') ?? ''
  const supabase = createServiceClient()
  if (!(await openJobForPin(supabase, jobId, person.org_id))) {
    return NextResponse.json({ error: 'That job is not open.' }, { status: 404 })
  }

  const [notesRes, photosRes] = await Promise.all([
    supabase
      .from('progress_notes')
      .select('id, body, created_at, updated_at, created_by_user_id, created_by_first_name')
      .eq('job_id', jobId)
      .eq('org_id', person.org_id)
      .is('deleted_at', null)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    supabase
      .from('photos')
      .select('id, file_url, caption, taken_at, uploaded_at, uploaded_by_name, uploaded_by_person_id')
      .eq('job_id', jobId)
      .order('uploaded_at', { ascending: false })
      .limit(LIMIT),
  ])
  if (notesRes.error) return NextResponse.json({ error: notesRes.error.message }, { status: 500 })
  if (photosRes.error) return NextResponse.json({ error: photosRes.error.message }, { status: 500 })

  const me = pinAuthorId(person)
  const items: PadItem[] = [
    ...(notesRes.data ?? []).map(n => ({
      kind: 'note' as const,
      id: n.id as string,
      body: (n.body as string) ?? '',
      at: n.created_at as string,
      updated_at: n.updated_at as string,
      by: (n.created_by_first_name as string) || 'Someone',
      mine: n.created_by_user_id === me,
    })),
    ...(photosRes.data ?? []).map(p => ({
      kind: 'photo' as const,
      id: p.id as string,
      file_url: p.file_url as string,
      caption: (p.caption as string | null) ?? '',
      at: ((p.taken_at as string | null) || (p.uploaded_at as string)),
      by: ((p.uploaded_by_name as string | null) ?? '').replace(/\s*\([^)]*\)\s*$/, '') || 'Someone',
      mine: p.uploaded_by_person_id === person.person_id,
    })),
  ]
  return NextResponse.json({ items: sortPad(items), me: pinAuthorName(person) })
}

export async function POST(req: Request) {
  const person = await photoBulkPerson(req)
  if (!person) return NextResponse.json({ error: 'Signed out. Enter your PIN again.' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { job_id?: unknown; body?: unknown; written_at?: unknown }
  const jobId = typeof body.job_id === 'string' ? body.job_id : ''
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) return NextResponse.json({ error: 'Note cannot be empty.' }, { status: 400 })
  if (text.length > NOTE_MAX_CHARS) return NextResponse.json({ error: 'Note is too long.' }, { status: 400 })

  const supabase = createServiceClient()
  if (!(await openJobForPin(supabase, jobId, person.org_id))) {
    return NextResponse.json({ error: 'That job is not open.' }, { status: 404 })
  }

  const at = noteWrittenAt(body.written_at)
  const author = pinAuthorId(person)
  const name = pinAuthorName(person)
  const { data, error } = await supabase
    .from('progress_notes')
    .insert({
      org_id: person.org_id,
      job_id: jobId,
      room: '',
      body: text,
      created_at: at,
      updated_at: at,
      created_by_user_id: author,
      updated_by_user_id: author,
      created_by_first_name: name,
      updated_by_first_name: name,
    })
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
      by: name,
      mine: true,
    },
  }, { status: 201 })
}
