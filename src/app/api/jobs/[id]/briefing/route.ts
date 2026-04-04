/*
 * app/api/jobs/[id]/briefing/route.ts
 *
 * POST /api/jobs/[id]/briefing
 *
 * Generates a plain-English job briefing for field workers — a short
 * professional description of what the job involves and a clear objective.
 * Uses Claude with just the public-safe fields (type, urgency, schedule,
 * access note, notes log). No client PII is passed to the AI.
 *
 * Called once per field-worker Details tab view and cached in component
 * state for the session — no DB writes, no cost on page refresh.
 *
 * Returns: { description: string, objective: string }
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const JOB_TYPE_LABELS: Record<string, string> = {
  crime_scene:      'Crime Scene Cleaning',
  hoarding:         'Hoarding Remediation',
  mold:             'Mould Remediation',
  sewage:           'Sewage Clean-up',
  trauma:           'Trauma Cleaning',
  unattended_death: 'Unattended Death Clean-up',
  flood:            'Flood Remediation',
  other:            'Specialist Cleaning',
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 })

  const supabase = createServiceClient()
  const { data: job } = await supabase
    .from('jobs')
    .select('job_type, urgency, site_address, scheduled_at, schedule_note, notes, assessment_data')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .single()

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const typeLabel = JOB_TYPE_LABELS[job.job_type] ?? 'Specialist Cleaning'
  const suburb = job.site_address?.split(',')[1]?.trim().replace(/\b(QLD|NSW|VIC|WA|SA|TAS|ACT|NT)\b.*/i, '').trim() ?? job.site_address

  // Pull assessment context if available (area names / hazards)
  const areas: string[] = (job.assessment_data?.areas ?? []).map((a: { name: string }) => a.name).filter(Boolean)
  const hazards: string[] = (job.assessment_data?.hazards ?? []).filter(Boolean)

  // Strip timestamps from notes log — just send the note text
  const noteLines = (job.notes ?? '').split('\n').filter(Boolean)
    .map((l: string) => l.replace(/^\[.+?\] /, '').trim())
    .slice(-5) // last 5 notes only

  const contextParts = [
    `Service type: ${typeLabel}`,
    `Urgency: ${job.urgency}`,
    `Location: ${suburb ?? 'site'}`,
    job.schedule_note ? `Access/site note: ${job.schedule_note}` : '',
    areas.length > 0 ? `Areas to be cleaned: ${areas.join(', ')}` : '',
    hazards.length > 0 ? `Known hazards: ${hazards.join(', ')}` : '',
    noteLines.length > 0 ? `Job notes: ${noteLines.join(' | ')}` : '',
  ].filter(Boolean).join('\n')

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-20250514',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `You are writing a job briefing for a biohazard cleaning field worker. Be direct, professional and practical. No client names or contact details.

Job details:
${contextParts}

Return ONLY a JSON object with exactly these two fields:
{
  "description": "2-3 sentence plain English overview of what this job involves and what to expect on site",
  "objective": "1-2 sentence clear statement of what the team needs to achieve — the definition of done"
}`,
    }],
  })

  const raw = (message.content[0] as { type: string; text: string }).text.trim()

  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  try {
    const parsed = JSON.parse(cleaned)
    return NextResponse.json({ description: parsed.description ?? '', objective: parsed.objective ?? '' })
  } catch {
    return NextResponse.json({ description: raw, objective: '' })
  }
}
