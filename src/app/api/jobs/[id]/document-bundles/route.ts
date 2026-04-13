/*
 * GET  /api/jobs/[id]/document-bundles — list composed bundles for a job
 * POST /api/jobs/[id]/document-bundles — create bundle (ordered document ids)
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

const MAX_PARTS = 20

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: jobId } = await params
    const { userId } = await auth()
    const { orgId } = await getOrgId(_req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createServiceClient()
    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .single()
    if (jobErr || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const { data, error } = await supabase
      .from('document_bundles')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ bundles: data ?? [] })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: jobId } = await params
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as { title?: string; part_document_ids?: string[] }
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Composed document'
    const ids = Array.isArray(body.part_document_ids) ? body.part_document_ids : []
    if (ids.length < 1) {
      return NextResponse.json({ error: 'part_document_ids must include at least one document' }, { status: 400 })
    }
    if (ids.length > MAX_PARTS) {
      return NextResponse.json({ error: `At most ${MAX_PARTS} documents per bundle` }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .single()
    if (jobErr || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const { data: docs, error: docsErr } = await supabase
      .from('documents')
      .select('id')
      .eq('job_id', jobId)
      .in('id', ids)
    if (docsErr) throw docsErr
    const found = new Set((docs ?? []).map(d => d.id))
    for (const uid of ids) {
      if (!found.has(uid)) {
        return NextResponse.json({ error: 'Each part must be a document on this job' }, { status: 400 })
      }
    }

    const { data: row, error: insErr } = await supabase
      .from('document_bundles')
      .insert({
        job_id: jobId,
        org_id: orgId,
        title,
        part_document_ids: ids,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (insErr) throw insErr
    return NextResponse.json({ bundle: row }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (msg.includes('document_bundles') || msg.includes('relation')) {
      return NextResponse.json(
        { error: 'document_bundles table missing — run supabase-migration-012-document-bundles.sql' },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
