import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(req: Request) {
  try {
    const { jobId, fileName, contentType } = await req.json()
    if (!jobId || !fileName) {
      return NextResponse.json({ error: 'Missing jobId or fileName' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const ext = fileName.split('.').pop()
    const path = `${jobId}/${Date.now()}.${ext}`

    const { data, error } = await supabase.storage
      .from('job-photos')
      .createSignedUploadUrl(path)

    if (error) throw error

    const publicUrl = supabase.storage.from('job-photos').getPublicUrl(path).data.publicUrl

    return NextResponse.json({ signedUrl: data.signedUrl, path, publicUrl })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
