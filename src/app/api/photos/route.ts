import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(req: Request) {
  try {
    const { job_id, file_url, caption, category } = await req.json()
    if (!job_id || !file_url) {
      return NextResponse.json({ error: 'Missing job_id or file_url' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('photos')
      .insert({ job_id, file_url, caption: caption ?? '', category: category ?? 'before' })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ photo: data }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
