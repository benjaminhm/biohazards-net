/*
 * POST /api/admin/platform-style-pdf — signed upload URL for platform-wide style PDFs.
 * Files go to company-assets/style-guides/platform/* (same bucket as org guides).
 * After upload, store publicUrl in platform_document_rules.document_rules[type + '_pdf'].
 */
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { isPlatformOperator } from '@/lib/platformAdmin'

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!(await isPlatformOperator(userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServiceClient()
  const { fileName, contentType } = await req.json() as { fileName?: string; contentType?: string }
  if (!fileName?.trim() || contentType !== 'application/pdf') {
    return NextResponse.json({ error: 'fileName and application/pdf contentType required' }, { status: 400 })
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `style-guides/platform/${safeName}`

  const { data, error } = await supabase.storage.from('company-assets').createSignedUploadUrl(path)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: urlData } = supabase.storage.from('company-assets').getPublicUrl(path)
  return NextResponse.json({ signedUrl: data.signedUrl, publicUrl: urlData.publicUrl })
}
