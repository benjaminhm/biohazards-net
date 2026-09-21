/*
 * POST /api/photos/docket-pdf-url — signed upload URL for a skip-company docket PDF.
 *
 * Client PUTs the original PDF straight to Supabase (company-assets/dockets/…)
 * so large files are not blocked by the Vercel function body limit (~4.5 MB).
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

export async function POST(req: Request) {
  try {
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as { jobId?: string }
    const jobId = String(body.jobId ?? '').trim()
    if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

    const supabase = createServiceClient()
    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (jobErr) throw jobErr
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const path = `dockets/${jobId}/${Date.now()}.pdf`
    const { data, error } = await supabase.storage
      .from('company-assets')
      .createSignedUploadUrl(path)
    if (error || !data?.signedUrl) {
      return NextResponse.json(
        { error: error?.message || 'Could not prepare PDF upload — check the company-assets bucket exists' },
        { status: 500 },
      )
    }

    const publicUrl = supabase.storage.from('company-assets').getPublicUrl(path).data.publicUrl
    return NextResponse.json({ signedUrl: data.signedUrl, path, publicUrl })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
