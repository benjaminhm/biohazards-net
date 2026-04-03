/*
 * app/api/company/logo/route.ts
 *
 * POST /api/company/logo — generates a signed upload URL for a company logo.
 * Returns both the signed upload URL and the resulting public URL so the
 * client can display the logo immediately after upload without a reload.
 *
 * Logos are stored in the 'company-assets' bucket under the 'logo/' prefix.
 * After upload, the caller should PATCH /api/company with { logo_url: publicUrl }.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(req: Request) {
  const supabase = createServiceClient()
  const body = await req.json()
  const { fileName, contentType } = body

  const path = `logo/${fileName}`

  const { data, error } = await supabase.storage
    .from('company-assets')
    .createSignedUploadUrl(path)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: urlData } = supabase.storage
    .from('company-assets')
    .getPublicUrl(path)

  return NextResponse.json({
    signedUrl: data.signedUrl,
    publicUrl: urlData.publicUrl,
  })
}
