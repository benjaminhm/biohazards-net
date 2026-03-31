import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(req: Request) {
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
