/*
 * /api/agent/chat — the Agent workspace conversation.
 *
 * GET  ?job=<id>  → { rows, drafts } — this user's running thread plus other
 *                   activity on the open job; marks the job read.
 * POST { text, active_job_id? } → runs one turn (head agent, or the open job's
 *                   file agent), saves every visible line, and returns
 *                   { active_job_id, rows, drafts }.
 *
 * Staff with the full job file only. Agents draft; nothing reaches a job until
 * staff approve, and nothing is ever sent to a client.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { getStaffFirstName } from '@/lib/clerkDisplayName'
import { handleChatTurn, loadChatView, markJobRead } from '@/lib/agent/workspaceAgent'

export const maxDuration = 300

const UUID = /^[0-9a-f-]{36}$/i

async function ownJobId(g: Extract<Awaited<ReturnType<typeof guardFullAccessStaff>>, { ok: true }>, raw: unknown): Promise<string | null> {
  if (typeof raw !== 'string' || !UUID.test(raw)) return null
  const { data } = await g.supabase.from('jobs').select('id').eq('id', raw).eq('org_id', g.orgId).maybeSingle()
  return (data?.id as string | undefined) ?? null
}

export async function GET(req: Request) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  const jobId = await ownJobId(g, new URL(req.url).searchParams.get('job'))
  if (jobId) await markJobRead(g.supabase, g.orgId, g.userId, jobId)
  const view = await loadChatView(g.supabase, g.orgId, g.userId, jobId)
  return NextResponse.json({ active_job_id: jobId, ...view })
}

export async function POST(req: Request) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  const apiKey = getAnthropicApiKey()
  if (!apiKey) return NextResponse.json({ error: 'Anthropic is not configured: set ANTHROPIC_API_KEY.' }, { status: 503 })

  const body = (await req.json().catch(() => ({}))) as { text?: unknown; active_job_id?: unknown }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: 'Say something first.' }, { status: 400 })
  if (text.length > 8000) return NextResponse.json({ error: 'That message is too long.' }, { status: 400 })
  const activeJobId = await ownJobId(g, body.active_job_id)

  try {
    const { active_job_id } = await handleChatTurn({
      supabase: g.supabase,
      orgId: g.orgId,
      userId: g.userId,
      firstName: await getStaffFirstName(g.userId),
      apiKey,
      text,
      activeJobId,
      role: g.role,
    })
    const view = await loadChatView(g.supabase, g.orgId, g.userId, active_job_id)
    return NextResponse.json({ active_job_id, ...view })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'The agent failed'
    console.error('[agent/chat]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
