/*
 * PATCH /api/photo/notes/photos/[id] — { caption } for a photo this PIN person
 * uploaded. The caption is the photo's description in the main app.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { photoBulkPerson } from '@/lib/photoBulkSession'
import { openJobForPin } from '@/lib/photoNotes'

const MAX_CAPTION = 2000

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const person = await photoBulkPerson(req)
  if (!person) return NextResponse.json({ error: 'Signed out. Enter your PIN again.' }, { status: 401 })
  const { id } = await params

  const body = (await req.json().catch(() => ({}))) as { caption?: unknown }
  if (typeof body.caption !== 'string') return NextResponse.json({ error: 'Missing caption.' }, { status: 400 })
  const caption = body.caption.trim().slice(0, MAX_CAPTION)

  const supabase = createServiceClient()
  const { data: photo } = await supabase
    .from('photos')
    .select('id, job_id')
    .eq('id', id)
    .eq('uploaded_by_person_id', person.person_id)
    .maybeSingle()
  if (!photo || !(await openJobForPin(supabase, photo.job_id as string, person.org_id))) {
    return NextResponse.json({ error: 'Photo not found.' }, { status: 404 })
  }

  const { error } = await supabase.from('photos').update({ caption }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ photo: { id, caption } })
}
