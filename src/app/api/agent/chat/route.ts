/*
 * /api/agent/chat — the Agent workspace conversation.
 *
 * GET  ?job=<id>[&agent=<doc type>] → { rows, drafts } — this user's running
 *                   thread plus other activity on the open job, or with agent
 *                   that document agent's conversation on the job; marks it read.
 * POST { text, active_job_id?, active_doc_agent? } → runs one turn (head
 *                   agent, the open job's file agent, or with active_doc_agent
 *                   that document agent directly), saves every visible line,
 *                   and returns { active_job_id, active_doc_agent, rows, drafts }.
 *
 * Staff with the full job file only. Agents draft; nothing reaches a job until
 * staff approve, and nothing is ever sent to a client.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { getStaffFirstName } from '@/lib/clerkDisplayName'
import { handleChatTurn, loadChatView, markDocRead, markJobRead } from '@/lib/agent/workspaceAgent'
import { isDocAgentType, type DocAgentType } from '@/lib/agent/subagents/types'

export const maxDuration = 300

const UUID = /^[0-9a-f-]{36}$/i

async function ownJobId(g: Extract<Awaited<ReturnType<typeof guardFullAccessStaff>>, { ok: true }>, raw: unknown): Promise<string | null> {
  if (typeof raw !== 'string' || !UUID.test(raw)) return null
  const { data } = await g.supabase.from('jobs').select('id').eq('id', raw).eq('org_id', g.orgId).maybeSingle()
  return (data?.id as string | undefined) ?? null
}

function docAgentParam(raw: unknown): DocAgentType | null {
  return isDocAgentType(raw) ? raw : null
}

export async function GET(req: Request) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  const params = new URL(req.url).searchParams
  const jobId = await ownJobId(g, params.get('job'))
  const docAgent = jobId ? docAgentParam(params.get('agent')) : null
  if (jobId && docAgent) await markDocRead(g.supabase, g.orgId, g.userId, jobId, docAgent)
  else if (jobId) await markJobRead(g.supabase, g.orgId, g.userId, jobId)
  const view = await loadChatView(g.supabase, g.orgId, g.userId, jobId, docAgent)
  return NextResponse.json({ active_job_id: jobId, active_doc_agent: docAgent, ...view })
}

export async function POST(req: Request) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  const apiKey = getAnthropicApiKey()
  if (!apiKey) return NextResponse.json({ error: 'Anthropic is not configured: set ANTHROPIC_API_KEY.' }, { status: 503 })

  const body = (await req.json().catch(() => ({}))) as { text?: unknown; active_job_id?: unknown; active_doc_agent?: unknown }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: 'Say something first.' }, { status: 400 })
  if (text.length > 8000) return NextResponse.json({ error: 'That message is too long.' }, { status: 400 })
  const activeJobId = await ownJobId(g, body.active_job_id)
  const activeDocAgent = activeJobId ? docAgentParam(body.active_doc_agent) : null

  try {
    const { active_job_id, active_doc_agent } = await handleChatTurn({
      supabase: g.supabase,
      orgId: g.orgId,
      userId: g.userId,
      firstName: await getStaffFirstName(g.userId),
      apiKey,
      text,
      activeJobId,
      activeDocAgent,
      role: g.role,
    })
    const view = await loadChatView(g.supabase, g.orgId, g.userId, active_job_id, active_doc_agent)
    return NextResponse.json({ active_job_id, active_doc_agent, ...view })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'The agent failed'
    console.error('[agent/chat]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
