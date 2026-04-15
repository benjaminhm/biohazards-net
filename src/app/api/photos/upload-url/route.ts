/*
 * app/api/photos/upload-url/route.ts
 *
 * POST /api/photos/upload-url — generates a signed upload URL for Supabase Storage.
 *
 * Client-side upload pattern:
 *   1. Call this endpoint to get a signed URL + the resulting public URL
 *   2. PUT multipart FormData to the signed URL (same shape as storage-js uploadToSignedUrl:
 *      append cacheControl + file blob under field name '')
 *   3. Call /api/photos to record the public URL in the database
 *
 * Path format: {jobId}/{timestamp}.{ext}
 * Stored in the 'job-photos' bucket (separate from 'company-assets').
 */
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
