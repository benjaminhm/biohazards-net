import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createServiceClient()

    // Get the photo record first so we can delete from Storage too
    const { data: photo, error: fetchErr } = await supabase
      .from('photos')
      .select('file_url')
      .eq('id', id)
      .single()

    if (fetchErr) throw fetchErr

    // Delete from Supabase Storage
    if (photo?.file_url) {
      const url = new URL(photo.file_url)
      // Extract path after /object/public/photos/
      const match = url.pathname.match(/\/object\/public\/photos\/(.+)/)
      if (match) {
        await supabase.storage.from('photos').remove([match[1]])
      }
    }

    // Delete from database
    const { error } = await supabase.from('photos').delete().eq('id', id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('photos')
      .update(body)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ photo: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
