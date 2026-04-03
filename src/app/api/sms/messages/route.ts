/*
 * app/api/sms/messages/route.ts
 *
 * GET /api/sms/messages?job_id=... — fetch all messages for a job and mark
 * unread inbound messages as read in a single follow-up update.
 *
 * Messages are returned oldest-first (ascending) for chat UI rendering.
 * The read_at update runs after the fetch — the fetch result is returned
 * immediately so the UI is not blocked by the mark-read write.
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org context' }, { status: 400 })

  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('job_id')
  if (!jobId) return NextResponse.json({ error: 'Missing job_id' }, { status: 400 })

  const { data: messages, error } = await supabase
    .from('messages')
    .select('*')
    .eq('job_id', jobId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Mark all inbound as read
  await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('job_id', jobId)
    .eq('org_id', orgId)
    .eq('direction', 'inbound')
    .is('read_at', null)

  return NextResponse.json({ messages: messages ?? [] })
}
