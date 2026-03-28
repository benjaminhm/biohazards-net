import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { text } = await req.json()

    if (!text?.trim()) {
      return NextResponse.json({ error: 'Note text required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Fetch current notes
    const { data: job, error: fetchErr } = await supabase
      .from('jobs')
      .select('notes')
      .eq('id', id)
      .single()

    if (fetchErr) throw fetchErr

    const timestamp = new Date().toLocaleString('en-AU', {
      timeZone: 'Australia/Brisbane',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

    const newEntry = `[${timestamp}] ${text.trim()}`
    const updatedNotes = job.notes ? `${job.notes}\n${newEntry}` : newEntry

    const { data, error } = await supabase
      .from('jobs')
      .update({ notes: updatedNotes, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ job: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
