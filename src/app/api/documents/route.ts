/*
 * app/api/documents/route.ts
 *
 * GET  /api/documents?jobId=... — fetch all documents for a job
 * POST /api/documents           — save a new document record
 *
 * Documents are HTML-renderable via /api/print/[id] — the content JSON blob
 * is passed to buildPrintHTML() in lib/printDocument.ts.
 *
 * Staff with the full job file only, and the job must be in their org. The
 * public print link and the client portal read documents directly.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { jobInOrg } from '@/lib/documentAccess'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const jobId = searchParams.get('jobId')
    if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

    const g = await guardFullAccessStaff(req)
    if (!g.ok) return g.response
    if (!(await jobInOrg(g.supabase, jobId, g.orgId))) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const { data, error } = await g.supabase
      .from('documents')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ documents: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const g = await guardFullAccessStaff(req)
    if (!g.ok) return g.response

    const { job_id, type, content, file_url } = await req.json()
    if (!job_id || !type || !content) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (!(await jobInOrg(g.supabase, job_id, g.orgId))) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const { data, error } = await g.supabase
      .from('documents')
      .insert({ job_id, type, content, file_url: file_url ?? null, org_id: g.orgId })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ document: data }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
