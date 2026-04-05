/*
 * app/api/jobs/[id]/briefing/route.ts
 *
 * POST /api/jobs/[id]/briefing
 *
 * Generates a plain-English job description for field workers: what the job is,
 * what to expect on site, and a clear objective. Uses Claude (Haiku) with:
 *   - Job type, urgency, schedule, notes (no client names in output instructions)
 *   - Full assessment_data (areas, observations, biohazard type, PPE, risks, etc.)
 *   - Narrative from generated documents when present (SOW, ATP, quote, report…)
 *
 * Returns: { description: string, objective: string }
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import type { AssessmentData } from '@/lib/types'
import Anthropic from '@anthropic-ai/sdk'

const MAX_DOC_CONTEXT_CHARS = 7500
const MAX_NOTE_LINES = 8

const anthropicKey = process.env.ANTHROPIC_API_KEY
const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null

const JOB_TYPE_LABELS: Record<string, string> = {
  crime_scene: 'Crime Scene Cleaning',
  hoarding: 'Hoarding Remediation',
  mold: 'Mould Remediation',
  sewage: 'Sewage Clean-up',
  trauma: 'Trauma Cleaning',
  unattended_death: 'Unattended Death Clean-up',
  flood: 'Flood Remediation',
  other: 'Specialist Cleaning',
}

/** Prefer these doc types for scope-of-work narrative (first match wins per type). */
const DOC_TYPES_ORDER = [
  'sow',
  'authority_to_proceed',
  'engagement_agreement',
  'quote',
  'report',
  'swms',
  'risk_assessment',
  'jsa',
] as const

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 20).trim()}… [truncated]`
}

function specialRisksLine(sr: AssessmentData['special_risks'] | undefined | null): string {
  if (!sr) return ''
  const labels: Record<string, string> = {
    sharps: 'sharps',
    chemicals: 'chemicals',
    structural_damage: 'structural damage',
    infectious_disease: 'infectious disease risk',
    vermin: 'vermin',
    mold_spores: 'mould spores',
  }
  const active = Object.entries(sr)
    .filter(([, v]) => v)
    .map(([k]) => labels[k] ?? k)
  return active.length ? `Special risk flags: ${active.join(', ')}` : ''
}

function ppeLine(ppe: AssessmentData['ppe_required'] | undefined | null): string {
  if (!ppe) return ''
  const labels: Record<string, string> = {
    gloves: 'gloves',
    tyvek_suit: 'Tyvek suit',
    respirator: 'respirator',
    face_shield: 'face shield',
    boot_covers: 'boot covers',
    double_bag: 'double-bag waste',
  }
  const active = Object.entries(ppe)
    .filter(([, v]) => v)
    .map(([k]) => labels[k] ?? k)
  return active.length ? `PPE indicated: ${active.join(', ')}` : ''
}

function areasLines(areas: AssessmentData['areas']): string[] {
  if (!areas?.length) return []
  return areas.map((a) => {
    const bits = [a.name]
    if (typeof a.sqm === 'number' && a.sqm > 0) bits.push(`${a.sqm} m²`)
    if (typeof a.hazard_level === 'number') bits.push(`hazard level ${a.hazard_level}`)
    const head = bits.filter(Boolean).join(' · ')
    if (a.description?.trim()) return `${head}: ${a.description.trim()}`
    return head
  })
}

/** Pull human-readable scope text from document content JSON (by type). */
function extractDocNarrative(docType: string, content: Record<string, unknown>): string {
  const parts: string[] = []

  switch (docType) {
    case 'sow': {
      const ex = str(content.executive_summary)
      const sc = str(content.scope)
      const meth = str(content.methodology)
      if (ex) parts.push(`Executive summary:\n${ex}`)
      if (sc) parts.push(`Scope of work:\n${sc}`)
      if (meth) parts.push(`Methodology:\n${meth}`)
      break
    }
    case 'authority_to_proceed': {
      const ss = str(content.scope_summary)
      const ac = str(content.access_details)
      const sp = str(content.special_conditions)
      if (ss) parts.push(`Scope summary:\n${ss}`)
      if (ac) parts.push(`Access:\n${ac}`)
      if (sp) parts.push(`Special conditions:\n${sp}`)
      break
    }
    case 'engagement_agreement': {
      const sd = str(content.services_description)
      if (sd) parts.push(`Services:\n${sd}`)
      break
    }
    case 'quote': {
      const intro = str(content.intro)
      const notes = str(content.notes)
      const items = content.line_items
      if (intro) parts.push(`Quote intro:\n${intro}`)
      if (Array.isArray(items) && items.length) {
        const lines = items
          .slice(0, 12)
          .map((row: { description?: string; qty?: number; unit?: string }) =>
            str(row.description) ? `• ${row.description}${row.qty != null ? ` (${row.qty} ${row.unit ?? ''})`.trim() : ''}` : ''
          )
          .filter(Boolean)
        if (lines.length) parts.push(`Line items:\n${lines.join('\n')}`)
      }
      if (notes) parts.push(`Quote notes:\n${notes}`)
      break
    }
    case 'report': {
      const ex = str(content.executive_summary)
      const site = str(content.site_conditions)
      const works = str(content.works_carried_out)
      if (ex) parts.push(`Executive summary:\n${ex}`)
      if (site) parts.push(`Site conditions:\n${site}`)
      if (works) parts.push(`Works:\n${works}`)
      break
    }
    case 'swms': {
      const pd = str(content.project_details)
      const ppe = str(content.ppe_required)
      if (pd) parts.push(`Project details:\n${pd}`)
      if (ppe) parts.push(`PPE (SWMS):\n${ppe}`)
      break
    }
    case 'risk_assessment': {
      const site = str(content.site_description)
      if (site) parts.push(`Site description:\n${site}`)
      const rows = content.risks
      if (Array.isArray(rows) && rows.length) {
        const lines = rows
          .slice(0, 15)
          .map((r: { hazard?: string; risk_rating?: string; likelihood?: string; consequence?: string }) => {
            const h = str(r.hazard)
            if (!h) return ''
            const rr = str(r.risk_rating)
            return `• ${h}${rr ? ` (${rr})` : ''}`
          })
          .filter(Boolean)
        if (lines.length) parts.push(`Risk register:\n${lines.join('\n')}`)
      }
      const rec = str(content.recommendations)
      if (rec) parts.push(`Recommendations:\n${rec}`)
      break
    }
    case 'jsa': {
      const jd = str(content.job_description)
      if (jd) parts.push(`Job description (JSA):\n${jd}`)
      break
    }
    default:
      break
  }

  return parts.join('\n\n')
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 })

  if (!anthropic || !anthropicKey) {
    return NextResponse.json(
      { error: 'Job description is unavailable (AI not configured).' },
      { status: 503 }
    )
  }

  const supabase = createServiceClient()
  const { data: job } = await supabase
    .from('jobs')
    .select('job_type, urgency, site_address, scheduled_at, schedule_note, notes, assessment_data')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .single()

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const typeLabel = JOB_TYPE_LABELS[job.job_type] ?? 'Specialist Cleaning'
  const suburb =
    job.site_address?.split(',')[1]?.trim().replace(/\b(QLD|NSW|VIC|WA|SA|TAS|ACT|NT)\b.*/i, '').trim() ??
    job.site_address

  const ad = job.assessment_data as AssessmentData | null

  const noteLines = (job.notes ?? '')
    .split('\n')
    .filter(Boolean)
    .map((l: string) => l.replace(/^\[.+?\] /, '').trim())
    .slice(-MAX_NOTE_LINES)

  const assessmentBlock = [
    ad?.biohazard_type ? `Biohazard / contamination type: ${ad?.biohazard_type}` : '',
    typeof ad?.contamination_level === 'number' ? `Contamination level (1–10): ${ad?.contamination_level}` : '',
    areasLines(ad?.areas ?? []).length ? `Areas:\n${areasLines(ad?.areas ?? []).map((l) => `  - ${l}`).join('\n')}` : '',
    str(ad?.observations) ? `Site observations:\n${str(ad?.observations)}` : '',
    str(ad?.access_restrictions) ? `Access restrictions:\n${str(ad?.access_restrictions)}` : '',
    specialRisksLine(ad?.special_risks),
    ppeLine(ad?.ppe_required),
    ad != null && typeof ad.estimated_hours === 'number' && ad.estimated_hours > 0
      ? `Estimated hours: ${ad.estimated_hours}`
      : '',
    ad != null && typeof ad.estimated_waste_litres === 'number' && ad.estimated_waste_litres > 0
      ? `Estimated waste (L): ${ad.estimated_waste_litres}`
      : '',
    ad?.custom_fields?.length
      ? `Extra fields:\n${ad.custom_fields.map((f) => `  - ${f.label}: ${f.value}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  // Latest document per type (documents ordered desc; first seen wins)
  const { data: docRows } = await supabase
    .from('documents')
    .select('type, content, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })

  const latestByType = new Map<string, Record<string, unknown>>()
  for (const row of docRows ?? []) {
    const t = row.type as string
    if (!latestByType.has(t)) latestByType.set(t, (row.content ?? {}) as Record<string, unknown>)
  }

  const docChunks: string[] = []
  for (const docType of DOC_TYPES_ORDER) {
    const content = latestByType.get(docType)
    if (!content || typeof content !== 'object') continue
    const narrative = extractDocNarrative(docType, content)
    if (narrative) docChunks.push(`--- From ${docType.replace(/_/g, ' ')} ---\n${narrative}`)
  }

  let docContext = docChunks.join('\n\n')
  if (docContext.length > MAX_DOC_CONTEXT_CHARS) {
    docContext = truncate(docContext, MAX_DOC_CONTEXT_CHARS)
  }

  const jobFacts = [
    `Service type: ${typeLabel}`,
    `Urgency: ${job.urgency}`,
    `Location (suburb/area): ${suburb ?? 'site'}`,
    job.schedule_note ? `Access / schedule note: ${job.schedule_note}` : '',
    noteLines.length ? `Recent job notes:\n${noteLines.map((n: string) => `  - ${n}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const promptBody = [
    '=== Structured job & assessment (use this together with documents) ===',
    jobFacts,
    assessmentBlock ? `\n=== Assessment details ===\n${assessmentBlock}` : '',
    docContext ? `\n=== Scope & documents on file ===\n${docContext}` : '\n(No scope documents on file yet — rely on assessment and job facts.)',
  ].join('\n')

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-20250514',
      max_tokens: 600,
      messages: [
        {
          role: 'user',
          content: `You are writing the on-site JOB DESCRIPTION for a biohazard/specialist cleaning field team.

Rules:
- Be direct, professional, and practical. Output must stand alone as what a technician reads before arriving.
- Do NOT include client names, phone numbers, emails, or street-level address numbers if you can describe the job without them (suburb/area is OK).
- If "Scope & documents on file" is present, treat it as authoritative for what work is included; align the description with it.
- If there are no documents, synthesise clearly from assessment + job facts.

Input:
${promptBody}

Return ONLY valid JSON with exactly these keys:
{
  "description": "3-5 sentences: what this job is, site conditions and risks to expect, and what work is in scope.",
  "objective": "1-3 sentences: clear definition of done for the team (what 'finished' looks like for this visit or phase)."
}`,
        },
      ],
    })

    const block = message.content[0]
    if (block.type !== 'text') {
      return NextResponse.json({ error: 'Unexpected AI response' }, { status: 502 })
    }

    const raw = block.text.trim()
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    try {
      const parsed = JSON.parse(cleaned) as { description?: string; objective?: string }
      const description = str(parsed.description)
      const objective = str(parsed.objective)
      if (!description && !objective) {
        return NextResponse.json({ description: raw.slice(0, 2000), objective: '' })
      }
      return NextResponse.json({ description, objective })
    } catch {
      return NextResponse.json({ description: raw, objective: '' })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'AI request failed'
    console.error('[briefing]', e)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
