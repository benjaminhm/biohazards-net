/*
 * POST /api/jobs/[id]/suggest-pre-v2
 *
 * Staff-only: draft a multi-part Post Remediation Evaluation. Each enabled part
 * (A = BCQ, B = CCQ, C = SACQ) is drafted from its own linked quote's
 * non-financial scope plus its technician note; whole-job sections from the
 * job context. Does NOT persist. NON-FINANCIAL — no money, no totals.
 *
 * Body: { pre: PostRemediationEvaluationV2, only?: 'a' | 'b' | 'c' }
 * `only` drafts just that part and skips the whole-job sections.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'
import { auth } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { mergedSowCapture } from '@/lib/sowCapture'
import { fetchPhotosForEvidenceSuggest, inferCapturePhaseFromCategory } from '@/lib/photoCapturePhase'
import { PRE_PART_DEFS, PRE_PART_KEYS, quoteScopeSummary } from '@/lib/postRemediationEvaluations'
import type { AssessmentData, JobType, Photo, PostRemediationEvaluationV2, PrePartKey } from '@/lib/types'

const SYSTEM = `You draft a multi-part Biohazard Remediation Completion Report for an Australian remediation company. The report is client-facing.

You receive JOB_CONTEXT with:
- whole_job: TECHNICIAN_BRIEF for the whole job, job details, Scope of Work, progress notes, room notes, progress photo metadata.
- parts: one entry per part to draft. Each has a fixed letter and title (Part A Biohazard Cleaning, Part B Contents Clearance, Part C Surface Area Cleaning), its own technician_brief, has_linked_quote, and quoted_scope (the linked quote's non-financial scope: rooms, objective, scope of work, volumes, tip address, inclusions, exclusions, assumptions).

VOICE & STYLE:
- First-person, plain tradesperson language ("we", "I"). Past tense. Factual, defensible, no embellishment.
- Australian English. Describe the actual works performed, not marketing copy.

RULES:
- Technician briefs are authoritative ground truth for what happened. Reflect confirmations, complexities, variations, and recommendations from them.
- Each part describes ONLY its own scope. Do not repeat another part's work inside a part.
- Part B (Contents Clearance): cover what was removed, volume, containment, transport, and the tip/disposal facility when given.
- Part C (Surface Area Cleaning): describe works room by room using the quoted rooms when given.
- Part A (Biohazard Cleaning): cover zone setup, contamination removal, treatment, and biohazard waste containment.
- In the written text never use the word "Part". Refer to a section by its letter and title, e.g. "B · Contents Clearance", or just by its title.
- When a part has has_linked_quote false, never mention a quote for that part; take its scope from the briefs and Scope of Work.
- Ground every statement in the provided data. Do NOT invent incidents, clearance/lab results, quantities, dates, products, or commitments.
- NEVER include money, prices, rates, totals, or variance figures.
- Use photo metadata only as internal context; never output raw metadata.
- Whole-job limitations combine the exclusions from every part's quoted scope, plus unaccessed areas and a testing/lab disclaimer.

Respond ONLY with valid JSON (no markdown fences). Shape exactly:
{
  "executive_summary": "",
  "site_conditions": [""],
  "recommendations": [""],
  "compliance": "",
  "limitations": "",
  "parts": {
    "<letter key a|b|c>": {
      "works": [{ "stage_name": "", "description": "" }],
      "methodology": "",
      "products": [{ "item_name": "", "usage_note": "" }],
      "waste": { "waste_type": "", "volume": "", "containment": "", "disposal": "" },
      "outcome_verification": ""
    }
  }
}
Include a "parts" entry for every part you were given, keyed by its lowercase key. If ONLY_PART is set, return only "parts" for that key and leave the whole-job fields empty.
Use empty string / empty array when there is nothing defensible from context. Never fabricate to fill a field.`

function isProgressEvidencePhoto(p: Pick<Photo, 'capture_phase' | 'category'>): boolean {
  if (p.capture_phase === 'progress') return true
  if (p.capture_phase === 'assessment') return false
  return p.category === 'during' || p.category === 'after'
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean)
}

function asRows<K extends string>(v: unknown, keys: readonly K[]): Record<K, string>[] {
  if (!Array.isArray(v)) return []
  const out: Record<K, string>[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const row = {} as Record<K, string>
    let any = false
    for (const k of keys) {
      const s = typeof obj[k] === 'string' ? (obj[k] as string).trim() : ''
      row[k] = s
      if (s) any = true
    }
    if (any) out.push(row)
  }
  return out
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orgId } = await getOrgId(req, userId)
    if (!orgId) {
      return NextResponse.json({ error: 'Organisation inactive or you have no active organisation' }, { status: 403 })
    }

    const apiKey = getAnthropicApiKey()
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Anthropic is not configured: set ANTHROPIC_API_KEY in .env.local, then restart the dev server.' },
        { status: 503 },
      )
    }

    const { id: jobId } = await params
    const body = (await req.json().catch(() => ({}))) as { pre?: PostRemediationEvaluationV2; only?: string }
    const pre = body.pre
    if (!pre || typeof pre !== 'object' || !pre.parts) {
      return NextResponse.json({ error: 'pre is required' }, { status: 400 })
    }
    const only = PRE_PART_KEYS.includes(body.only as PrePartKey) ? (body.only as PrePartKey) : undefined
    const partKeys = (only ? [only] : PRE_PART_KEYS).filter(k => pre.parts[k]?.enabled)
    if (partKeys.length === 0) {
      return NextResponse.json({ error: 'Switch on at least one part first.' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data: jobRow, error: jobErr } = await supabase
      .from('jobs')
      .select('id, job_type, site_address, urgency, client_name, client_organization_name, notes, assessment_data')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (jobErr) throw jobErr
    if (!jobRow) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    const job = jobRow as {
      job_type: JobType
      site_address: string
      urgency: string | null
      client_name: string
      client_organization_name: string | null
      notes: string | null
      assessment_data: AssessmentData | null
    }
    const ad = job.assessment_data

    const quoteIds = partKeys.map(k => pre.parts[k].source_quote_document_id).filter((id): id is string => !!id)
    const [quotesRes, photosRes, pnRes, prnRes] = await Promise.all([
      quoteIds.length
        ? supabase.from('documents').select('id, type, content').eq('job_id', jobId).in('id', quoteIds)
        : Promise.resolve({ data: [] as { id: string; type: string; content: unknown }[] }),
      fetchPhotosForEvidenceSuggest(supabase, jobId),
      supabase
        .from('progress_notes')
        .select('room, body')
        .eq('job_id', jobId)
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase
        .from('progress_room_notes')
        .select('room_name, note')
        .eq('job_id', jobId)
        .eq('org_id', orgId)
        .order('room_name', { ascending: true }),
    ])

    const quotesById = new Map((quotesRes.data ?? []).map(d => [d.id, d]))
    const parts = partKeys.map(k => {
      const part = pre.parts[k]
      const def = PRE_PART_DEFS[k]
      const doc = part.source_quote_document_id ? quotesById.get(part.source_quote_document_id) : undefined
      const linked = !!doc && doc.type === def.docType
      return {
        key: k,
        letter: def.letter,
        title: def.title,
        technician_brief: (part.generation_brief ?? '').trim() || null,
        has_linked_quote: linked,
        quoted_scope: linked ? quoteScopeSummary(doc.content as Record<string, unknown>) : null,
        actual_volume_m3: k === 'b' ? (part.actual_volume_m3 ?? '').trim() || null : undefined,
      }
    })

    const photos = (photosRes.data ?? []) as Pick<Photo, 'area_ref' | 'category' | 'caption' | 'capture_phase'>[]
    const sow = mergedSowCapture(ad)
    const wholeJob = {
      technician_brief: (pre.generation_brief ?? '').trim() || null,
      attendance: (pre.attendance ?? '').trim() || null,
      job: {
        job_type: job.job_type,
        site_address: job.site_address,
        urgency: job.urgency,
        client_name: job.client_name,
        client_organization_name: (job.client_organization_name ?? '').trim() || null,
        notes: job.notes,
      },
      areas: (ad?.areas ?? []).map(a => (a.name || '').trim()).filter(Boolean),
      sow_planned: {
        objective: sow.objective.trim(),
        scope_work: sow.scope_work.trim(),
        methodology: sow.methodology.trim(),
      },
      progress_notes: (pnRes.data ?? []).map((n: { room: string; body: string }) => ({ room: (n.room || '').trim(), body: (n.body || '').trim() })),
      progress_room_notes: (prnRes.data ?? []).map((n: { room_name: string; note: string }) => ({
        room_name: (n.room_name || '').trim(),
        note: (n.note || '').trim(),
      })),
      progress_photo_metadata: photos.filter(isProgressEvidencePhoto).map(p => ({
        area_ref: (p.area_ref || '').trim() || null,
        caption: (p.caption || '').trim() || null,
        capture_phase: p.capture_phase != null ? p.capture_phase : inferCapturePhaseFromCategory(p.category),
      })),
    }

    const hasSignal =
      !!wholeJob.technician_brief ||
      parts.some(p => p.technician_brief || p.quoted_scope) ||
      wholeJob.progress_notes.some(n => n.body) ||
      wholeJob.progress_room_notes.some(n => n.note) ||
      wholeJob.progress_photo_metadata.length > 0 ||
      !!wholeJob.sow_planned.objective ||
      !!wholeJob.sow_planned.scope_work ||
      (job.notes ?? '').trim().length > 0
    if (!hasSignal) {
      return NextResponse.json(
        { error: 'Add a technician note, link a quote, or add progress notes or photos before drafting.' },
        { status: 400 },
      )
    }

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: CLAUDE_SONNET_MODEL,
      max_tokens: 16384,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `ONLY_PART: ${only ?? 'none'}\n\nDraft the multi-part Post Remediation Evaluation from this data:\n\n${JSON.stringify({ whole_job: wholeJob, parts }, null, 2)}`,
        },
      ],
    })

    const block = message.content[0]
    const rawText = block?.type === 'text' ? block.text.trim() : ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 })
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      return NextResponse.json({ error: 'Invalid JSON from AI' }, { status: 500 })
    }

    const root = asObject(parsed)
    const rawParts = asObject(root.parts)
    const outParts: Record<string, unknown> = {}
    for (const k of partKeys) {
      const p = asObject(rawParts[k])
      const waste = asObject(p.waste)
      outParts[k] = {
        works_rows: asRows(p.works, ['stage_name', 'description'] as const),
        methodology: asString(p.methodology),
        products_rows: asRows(p.products, ['item_name', 'usage_note'] as const),
        waste: {
          waste_type: asString(waste.waste_type),
          volume: asString(waste.volume),
          containment: asString(waste.containment),
          disposal: asString(waste.disposal),
        },
        outcome_verification: asString(p.outcome_verification),
      }
    }

    if (only) return NextResponse.json({ parts: outParts })
    return NextResponse.json({
      executive_summary: asString(root.executive_summary),
      site_conditions: asStringArray(root.site_conditions),
      recommendations: asStringArray(root.recommendations),
      compliance: asString(root.compliance),
      limitations: asString(root.limitations),
      parts: outParts,
    })
  } catch (e: unknown) {
    console.error('[suggest-pre-v2]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Suggest failed' }, { status: 500 })
  }
}
