/*
 * POST /api/admin/platform-style-pdf
 *
 * Two modes (platform operators only):
 * 1) multipart/form-data, field "file" — server uploads to Storage (stays under ~4 MB so
 *    Vercel/serverless request body limits are not hit; plain-text 413 breaks JSON clients).
 * 2) application/json { fileName, contentType: "application/pdf" } — returns signedUrl +
 *    publicUrl for browser PUT (large PDFs; requires Supabase Storage CORS for platform host).
 */
import { auth } from '@clerk/nextjs/server'
import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { isPlatformOperator } from '@/lib/platformAdmin'
import { PLATFORM_STYLE_PDF_PROXY_MAX_BYTES } from '@/lib/platformStylePdfLimits'

const MAX_PROXY_UPLOAD_BYTES = PLATFORM_STYLE_PDF_PROXY_MAX_BYTES

const MAX_SIGNED_UPLOAD_BYTES = 15 * 1024 * 1024

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!(await isPlatformOperator(userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const contentTypeHeader = req.headers.get('content-type') || ''

  if (contentTypeHeader.includes('application/json')) {
    return handleSignedUrlRequest(req)
  }

  return handleMultipartUpload(req)
}

async function handleSignedUrlRequest(req: Request) {
  const body = (await req.json()) as { fileName?: string; contentType?: string }
  const fileName = body.fileName?.trim()
  if (!fileName || body.contentType !== 'application/pdf') {
    return NextResponse.json({ error: 'fileName and application/pdf contentType required' }, { status: 400 })
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `style-guides/platform/${safeName}`

  const supabase = createServiceClient()
  const { data, error } = await supabase.storage.from('company-assets').createSignedUploadUrl(path)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: urlData } = supabase.storage.from('company-assets').getPublicUrl(path)
  return NextResponse.json({
    signedUrl: data.signedUrl,
    publicUrl: urlData.publicUrl,
    maxBytes: MAX_SIGNED_UPLOAD_BYTES,
  })
}

async function handleMultipartUpload(req: Request) {
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
  if (blob.size > MAX_PROXY_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `PDF larger than ${Math.floor(MAX_PROXY_UPLOAD_BYTES / (1024 * 1024))} MB — use direct upload (client requests JSON mode)`,
        code: 'PAYLOAD_TOO_LARGE_FOR_PROXY',
      },
      { status: 413 }
    )
  }
  if (blob.size > MAX_SIGNED_UPLOAD_BYTES) {
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
