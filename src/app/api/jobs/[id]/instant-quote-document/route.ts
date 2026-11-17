/*
 * POST /api/jobs/[id]/instant-quote-document
 *
 * The saved Fast Quote as a quote document in the job's Documents, composed on
 * the server exactly as "Generate quote" composes it, ready to go on a client
 * link (POST /api/signing). The job's latest Fast Quote document is replaced
 * with what is saved now, unless the client has accepted it, in which case a
 * new one is made.
 *
 * Returns the document id and, when a link holding that document is still
 * waiting to be signed, when it was made: a new link replaces it.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { composeDocumentContent } from '@/lib/composeDocument'
import { normalizeContentsClearanceStandards } from '@/lib/contentsClearanceQuote'
import { instantQuoteProblems, normalizeInstantQuoteCapture } from '@/lib/instantQuote'
import { sharedEngagementAgreement } from '@/lib/quoteEngagement'
import { normalizeSurfaceAreaCleaningStandards } from '@/lib/surfaceAreaCleaningQuote'
import type { Job } from '@/lib/types'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardFullAccessStaff(req)
  if (!guard.ok) return guard.response
  const { supabase, orgId } = guard
  const { id } = await params

  const { data: job } = await supabase.from('jobs').select('*').eq('id', id).eq('org_id', orgId).maybeSingle()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const saved = (job.assessment_data as { instant_quote?: unknown } | null)?.instant_quote
  if (saved == null) return NextResponse.json({ error: 'Save the Fast Quote first.' }, { status: 400 })
  const problems = instantQuoteProblems(normalizeInstantQuoteCapture(saved))
  if (problems.length) return NextResponse.json({ error: problems.join(' ') }, { status: 400 })

  const { data: profile } = await supabase
    .from('company_profile')
    .select('contents_clearance_standards, surface_area_cleaning_standards')
    .eq('org_id', orgId)
    .limit(1)
    .maybeSingle()
  const { content } = composeDocumentContent('instant_quote', job as unknown as Job, {
    instantQuoteEngagement: sharedEngagementAgreement(
      normalizeContentsClearanceStandards(profile?.contents_clearance_standards).engagement_agreement,
      normalizeSurfaceAreaCleaningStandards(profile?.surface_area_cleaning_standards).engagement_agreement,
    ),
  })

  const { data: latest } = await supabase
    .from('documents')
    .select('id')
    .eq('job_id', id)
    .eq('org_id', orgId)
    .eq('type', 'instant_quote')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data: accepted } = latest
    ? await supabase.from('quote_acceptances').select('document_id').eq('document_id', latest.id).maybeSingle()
    : { data: null }

  let documentId: string
  if (latest && !accepted) {
    const { error } = await supabase.from('documents').update({ content }).eq('id', latest.id).eq('org_id', orgId)
    if (error) return NextResponse.json({ error: `Saving the quote failed: ${error.message}` }, { status: 500 })
    documentId = latest.id as string
  } else {
    const { data: doc, error } = await supabase
      .from('documents')
      .insert({ job_id: id, org_id: orgId, type: 'instant_quote', content, file_url: null })
      .select('id')
      .single()
    if (error || !doc) return NextResponse.json({ error: `Saving the quote failed: ${error?.message ?? 'no id'}` }, { status: 500 })
    documentId = doc.id as string
  }

  // A link still waiting that holds this quote: on several-quote links through its items, on older links directly.
  const { data: items } = await supabase.from('signing_request_items').select('request_id').eq('org_id', orgId).eq('document_id', documentId)
  const requestIds = ((items ?? []) as { request_id: string }[]).map(i => i.request_id)
  const { data: open } = await supabase
    .from('signing_requests')
    .select('sent_at, to_name')
    .eq('org_id', orgId)
    .in('status', ['sent', 'viewed'])
    .or([`document_id.eq.${documentId}`, ...(requestIds.length ? [`id.in.(${requestIds.join(',')})`] : [])].join(','))
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ documentId, waiting: open ?? null })
}
