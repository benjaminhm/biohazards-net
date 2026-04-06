/*
 * GET /api/jobs/[id]/email — list inbound email messages for a job (org-scoped).
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: jobId } = await params
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createServiceClient()
    const { data: job } = await supabase.from('jobs').select('id').eq('id', jobId).eq('org_id', orgId).single()
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: rows, error } = await supabase
      .from('job_email_messages')
      .select('id, from_address, to_address, subject, body_text, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true })

    if (error) throw error
    return NextResponse.json({ messages: rows ?? [] })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
