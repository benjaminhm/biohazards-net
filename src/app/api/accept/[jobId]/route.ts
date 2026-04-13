/*
 * app/api/accept/[jobId]/route.ts
 *
 * Public endpoint for online quote acceptance. Linked from PDF quotes and emails.
 *
 * GET  — returns job summary + latest quote for the /accept/[jobId] confirmation page.
 *   No auth required — client accesses this directly from an emailed/PDF link.
 *
 * POST — deprecated. Online quote acceptance is no longer recorded in-app;
 *   signing is handled externally (e.g. PandaDoc). Returns a static message
 *   without mutating the job.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  await params
  return NextResponse.json({
    deprecated: true,
    ok: false,
    message:
      'Quote acceptance is no longer recorded through this link. Signing is completed through our document signing process (e.g. PandaDoc). Please contact us if you need the signing link.',
  })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  const supabase = createServiceClient()

  const { data: job, error } = await supabase
    .from('jobs')
    .select('id, client_name, site_address, job_type, status, urgency')
    .eq('id', jobId)
    .single()

  if (error || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // Get latest quote
  const { data: docs } = await supabase
    .from('documents')
    .select('content, created_at')
    .eq('job_id', jobId)
    .eq('type', 'quote')
    .order('created_at', { ascending: false })
    .limit(1)

  const quoteContent = docs?.[0]?.content as Record<string, unknown> | null

  return NextResponse.json({ job, quote: quoteContent })
}
