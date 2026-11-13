/*
 * app/api/company/style-pdf/route.ts
 *
 * POST /api/company/style-pdf — generates a signed upload URL for a document
 * style guide PDF. These PDFs are attached to Claude prompts as example
 * documents when generating new documents of the same type.
 *
 * Stored in 'company-assets' bucket under 'style-guides/' prefix.
 * After upload, the caller should PATCH /api/company with
 * { document_rules: { [type + '_pdf']: publicUrl } }.
 *
 * /api/company is a public path in the proxy, so the session is checked here.
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/staffAuth'
import { getOrgId } from '@/lib/org'
import { createServiceClient } from '@/lib/supabase'

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No organisation' }, { status: 403 })

  const supabase = createServiceClient()
  const { fileName, contentType } = await req.json()

  const path = `style-guides/${fileName}`

  const { data, error } = await supabase.storage
    .from('company-assets')
    .createSignedUploadUrl(path)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: urlData } = supabase.storage
    .from('company-assets')
    .getPublicUrl(path)

  return NextResponse.json({ signedUrl: data.signedUrl, publicUrl: urlData.publicUrl })
}
