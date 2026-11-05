/*
 * POST /api/agent
 *
 * Staff chat agent: natural language in, tool calls against job data out.
 * Stateless — the drawer sends the whole conversation (Anthropic message
 * format) each turn. Read tools run in a loop; a write tool stops the loop and
 * comes back as `pending` so staff can Approve or Decline it. The next request
 * carries `approval` and the loop resumes from there.
 *
 * Staff-only (full job file roles). Never contacts clients.
 *
 * Input  : { messages: MessageParam[], job_id?: string, approval?: { tool_use_id: string, approved: boolean } }
 * Output : { messages: MessageParam[], pending?: { tool_use_id, name, input, summary } }
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'
import { auth } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { getStaffFirstName } from '@/lib/clerkDisplayName'
import { anthropicToolDefs, getAgentTool, runAgentTool, type AgentContext } from '@/lib/agent/tools'
import { DECLINED, closeSkippedApproval, lastToolUse, toolResult, trimHistory } from '@/lib/agent/history'

export const maxDuration = 60

const MAX_STEPS = 8
const MAX_MESSAGES = 60
const FULL_ACCESS_ROLES = new Set(['admin', 'owner', 'manager', 'team_lead'])

type Msg = Anthropic.MessageParam

function systemPrompt(staffFirstName: string, jobId: string | null) {
  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Brisbane' })
  return `You are the in-app assistant for staff of an Australian biohazard remediation company. You help ${staffFirstName || 'the staff member'} work their job files by calling tools instead of them clicking through forms.

Today is ${today}.${jobId ? `\nThe staff member has job ${jobId} open. "This job" means that one unless they say otherwise.` : ''}

RULES:
- Use tools to look things up. Never guess ids, photo ids, statuses or counts.
- Resolve a job by name or address with find_jobs. If more than one matches, ask which one.
- Write tools (adding notes, changing status, changing photos) are shown to the staff member for approval before they run. Call them directly when asked; do not ask "shall I?" first.
- If a write is declined, ask what they want instead. Do not retry the same action.
- You cannot email, SMS or otherwise contact clients. If asked, say staff send client messages themselves from the job file.
- When the staff member corrects you ("no, the other kitchen", "only the after photos"), redo the step with the correction.
- Australian English. Short, plain replies. No markdown headings.`
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) {
      return NextResponse.json({ error: 'Organisation inactive or you have no active organisation' }, { status: 403 })
    }
    const supabase = createServiceClient()
    const { data: orgUser } = await supabase
      .from('org_users')
      .select('role')
      .eq('clerk_user_id', userId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (!FULL_ACCESS_ROLES.has((orgUser as { role?: string } | null)?.role ?? '')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const apiKey = getAnthropicApiKey()
    if (!apiKey) {
      return NextResponse.json({ error: 'Anthropic is not configured: set ANTHROPIC_API_KEY.' }, { status: 503 })
    }

    const body = (await req.json().catch(() => ({}))) as {
      messages?: Msg[]
      job_id?: string
      approval?: { tool_use_id?: string; approved?: boolean }
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 })
    }
    const messages = closeSkippedApproval(trimHistory(body.messages, MAX_MESSAGES))
    const jobId = typeof body.job_id === 'string' && body.job_id ? body.job_id : null

    const ctx: AgentContext = { userId, orgId, supabase, staffFirstName: await getStaffFirstName(userId) }

    if (body.approval) {
      const pending = lastToolUse(messages)
      if (!pending || pending.id !== body.approval.tool_use_id) {
        return NextResponse.json({ error: 'Nothing waiting for approval' }, { status: 400 })
      }
      if (body.approval.approved) {
        const r = await runAgentTool(ctx, pending.name, pending.input as Record<string, unknown>)
        messages.push(toolResult(pending.id, r.content, r.is_error))
      } else {
        messages.push(toolResult(pending.id, DECLINED, false))
      }
    }

    const anthropic = new Anthropic({ apiKey })
    const tools = anthropicToolDefs()
    const system = systemPrompt(ctx.staffFirstName, jobId)

    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await anthropic.messages.create({
        model: CLAUDE_SONNET_MODEL,
        max_tokens: 1500,
        system,
        tools,
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        messages,
      })
      messages.push({ role: 'assistant', content: res.content })

      const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      if (res.stop_reason !== 'tool_use' || !use) return NextResponse.json({ messages })

      const tool = getAgentTool(use.name)
      if (tool?.kind === 'write') {
        const input = use.input as Record<string, unknown>
        return NextResponse.json({
          messages,
          pending: { tool_use_id: use.id, name: use.name, input, summary: tool.describe?.(input) ?? use.name },
        })
      }

      const r = await runAgentTool(ctx, use.name, use.input as Record<string, unknown>)
      messages.push(toolResult(use.id, r.content, r.is_error))
    }

    messages.push({ role: 'assistant', content: 'That took more steps than I allow in one go. Tell me what to do next.' })
    return NextResponse.json({ messages })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
