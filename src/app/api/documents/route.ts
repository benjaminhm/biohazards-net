/*
 * app/api/documents/route.ts
 *
 * GET  /api/documents?jobId=... — fetch all documents for a job
 * POST /api/documents           — save a new document record
 *
 * Documents are HTML-renderable via /api/print/[id] — the content JSON blob
 * is passed to buildPrintHTML() in lib/printDocument.ts.
 *
 * GET: if orgId is available it is used for scoping; it may be absent on
 * public print routes so we allow the query without the org filter in that case.
 * POST: org_id is set if resolved; documents can exist without org_id for
 * backwards-compatibility with older records.
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const jobId = searchParams.get('jobId')
    if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)

    const supabase = createServiceClient()
    let query = supabase
      .from('documents')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })

    if (orgId) {
      query = query.eq('org_id', orgId)
    }

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ documents: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)

    const { job_id, type, content, file_url } = await req.json()
    if (!job_id || !type || !content) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('documents')
      .insert({ job_id, type, content, file_url: file_url ?? null, org_id: orgId ?? undefined })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ document: data }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
