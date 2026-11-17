/*
 * app/api/tracking/jobs/[jobId]/route.ts
 *
 * GET — the job's feed as the signed-in client sees it. Image links are signed
 * and expire after two hours; the page fetches again when it comes back into view.
 */
import { NextResponse } from 'next/server'
import { gateViewer } from '@/lib/tracking/route'
import { clientFeed } from '@/lib/tracking/server'

export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const g = await gateViewer(req)
  if (!g.ok) return g.response
  const job = g.jobs.find(j => j.jobId === jobId)
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const posts = await clientFeed(g.supabase, jobId)
  await g.supabase.from('job_viewers').update({ last_seen_at: new Date().toISOString() }).eq('id', job.viewerId)

  return NextResponse.json(
    { job: { id: job.jobId, title: job.siteAddress || job.clientName || 'Your job' }, posts },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
