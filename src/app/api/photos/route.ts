/*
 * app/api/photos/route.ts
 *
 * POST /api/photos — record a photo after it has been uploaded to Storage.
 *
 * The upload itself uses a signed URL from /api/photos/upload-url.
 * Once the upload completes, the client calls this endpoint with the
 * resulting public URL to create the database record.
 *
 * Photos belong to a job (job_id) and optionally an area (area_ref).
 * category must be one of: before | assessment | during | after
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

export async function POST(req: Request) {
  try {
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)

    const { job_id, file_url, caption, area_ref, category } = await req.json()
    if (!job_id || !file_url) {
      return NextResponse.json({ error: 'Missing job_id or file_url' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('photos')
      .insert({
        job_id,
        file_url,
        caption: caption ?? '',
        area_ref: area_ref ?? '',
        category: category ?? 'before',
        org_id: orgId ?? undefined,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ photo: data }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
