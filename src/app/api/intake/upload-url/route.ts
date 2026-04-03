/*
 * app/api/intake/upload-url/route.ts
 *
 * POST /api/intake/upload-url — generates a signed upload URL for photos
 * submitted via the public client intake form (/new-client).
 *
 * No auth required — photo upload must work before any job or session exists.
 * A sessionId (UUID generated client-side) groups the photos under one path
 * so they can be bulk-attached to the job after intake submission.
 *
 * Path: intake/{sessionId}/{timestamp}-{random}.{ext}
 * A random suffix is added to prevent filename collisions on concurrent uploads.
 */
// Public — used by the client intake form for photo uploads before a job exists
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(req: Request) {
  try {
    const { sessionId, fileName, contentType } = await req.json()
    if (!sessionId || !fileName) {
      return NextResponse.json({ error: 'Missing sessionId or fileName' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const ext = fileName.split('.').pop()?.toLowerCase() ?? 'jpg'
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const path = `intake/${sessionId}/${safeName}`

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
