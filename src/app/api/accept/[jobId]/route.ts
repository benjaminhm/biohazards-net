/*
 * app/api/accept/[jobId]/route.ts
 *
 * Public endpoint for online quote acceptance. Linked from PDF quotes and emails.
 *
 * GET  — returns job summary + latest quote for the /accept/[jobId] confirmation page.
 *   No auth required — client accesses this directly from an emailed/PDF link.
 *
 * POST — marks the job as 'accepted', sends an internal email notification,
 *   and appends a timestamped note to the job's notes log.
 *
 * Idempotent: if the job is already 'accepted', returns { alreadyAccepted: true }
 * without making any changes — safe to call multiple times from the same link.
 *
 * Email failures are caught and logged but do not block the acceptance response.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { sendQuoteAcceptedEmail } from '@/lib/email'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  const supabase = createServiceClient()

  // Fetch job
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (jobErr || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  if (job.status === 'accepted') {
    return NextResponse.json({ alreadyAccepted: true, job })
  }

  // Update status to accepted
  const { data: updated, error: updateErr } = await supabase
    .from('jobs')
    .update({
      status: 'accepted',
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .select()
    .single()

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // Fetch latest quote document for reference + total
  const { data: docs } = await supabase
    .from('documents')
    .select('*')
    .eq('job_id', jobId)
    .eq('type', 'quote')
    .order('created_at', { ascending: false })
    .limit(1)

  const latestQuote = docs?.[0]
  const quoteContent = latestQuote?.content as Record<string, unknown> | null

  // Send email notification
  try {
    await sendQuoteAcceptedEmail({
      jobId,
      clientName: job.client_name,
      siteAddress: job.site_address,
      jobType: job.job_type,
      reference: (quoteContent?.reference as string) || `Q-${jobId.slice(0, 8)}`,
      total: (quoteContent?.total as number) || 0,
    })
  } catch (emailErr) {
    console.error('Email notification failed:', emailErr)
    // Don't fail the request if email fails
  }

  // Append note to job
  const timestamp = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })
  const note = `[${timestamp}] Quote accepted by client online.`
  await supabase
    .from('jobs')
    .update({ notes: job.notes ? `${job.notes}\n${note}` : note })
    .eq('id', jobId)

  return NextResponse.json({ success: true, job: updated })
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
