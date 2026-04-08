/*
 * POST /api/admin/platform-style-pdf — upload a platform-wide style PDF (multipart).
 * Files go to company-assets/style-guides/platform/* (same bucket as org guides).
 * Server-side upload avoids browser → Supabase CORS (platform.biohazards.net must often
 * be listed in Supabase Storage CORS; proxying removes that requirement).
 *
 * Body: multipart/form-data with field "file" (application/pdf).
 * Returns: { publicUrl }
 */
import { auth } from '@clerk/nextjs/server'
import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { isPlatformOperator } from '@/lib/platformAdmin'

const MAX_BYTES = 15 * 1024 * 1024

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!(await isPlatformOperator(userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart form with file field' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }

  const blob = file as File
  if (blob.size === 0) {
    return NextResponse.json({ error: 'Empty file' }, { status: 400 })
  }
  if (blob.size > MAX_BYTES) {
    return NextResponse.json({ error: 'PDF too large (max 15 MB)' }, { status: 400 })
  }

  const mime = blob.type || 'application/octet-stream'
  if (mime !== 'application/pdf' && !blob.name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'File must be a PDF' }, { status: 400 })
  }

  const safeBase = (blob.name || 'style.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
  const path = `style-guides/platform/${Date.now()}-${randomUUID().slice(0, 8)}-${safeBase}`

  const supabase = createServiceClient()
  const buffer = Buffer.from(await blob.arrayBuffer())

  const { error: upErr } = await supabase.storage.from('company-assets').upload(path, buffer, {
    contentType: 'application/pdf',
    upsert: false,
  })

  if (upErr) {
    return NextResponse.json(
      { error: upErr.message || 'Storage upload failed — check company-assets bucket exists' },
      { status: 500 }
    )
  }

  const { data: urlData } = supabase.storage.from('company-assets').getPublicUrl(path)
  return NextResponse.json({ publicUrl: urlData.publicUrl })
}
