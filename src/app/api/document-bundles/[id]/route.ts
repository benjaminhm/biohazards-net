/*
 * PATCH  /api/document-bundles/[id] — update title and/or part order
 * DELETE /api/document-bundles/[id] — remove bundle (does not delete source documents)
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

const MAX_PARTS = 20

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as { title?: string; part_document_ids?: string[] }
    const supabase = createServiceClient()

    const { data: existing, error: exErr } = await supabase
      .from('document_bundles')
      .select('id, job_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()
    if (exErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.title === 'string' && body.title.trim()) updates.title = body.title.trim()

    if (body.part_document_ids !== undefined) {
      const ids = Array.isArray(body.part_document_ids) ? body.part_document_ids : []
      if (ids.length < 1) {
        return NextResponse.json({ error: 'part_document_ids must include at least one document' }, { status: 400 })
      }
      if (ids.length > MAX_PARTS) {
        return NextResponse.json({ error: `At most ${MAX_PARTS} documents per bundle` }, { status: 400 })
      }
      const { data: docs, error: docsErr } = await supabase
        .from('documents')
        .select('id')
        .eq('job_id', existing.job_id)
        .in('id', ids)
      if (docsErr) throw docsErr
      const found = new Set((docs ?? []).map(d => d.id))
      for (const uid of ids) {
        if (!found.has(uid)) {
          return NextResponse.json({ error: 'Each part must be a document on this job' }, { status: 400 })
        }
      }
      updates.part_document_ids = ids
    }

    const { data, error } = await supabase
      .from('document_bundles')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ bundle: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { userId } = await auth()
    const { orgId } = await getOrgId(_req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createServiceClient()
    const { error } = await supabase.from('document_bundles').delete().eq('id', id).eq('org_id', orgId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
