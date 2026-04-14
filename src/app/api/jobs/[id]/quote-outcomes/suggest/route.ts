import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { mergedSowCapture } from '@/lib/sowCapture'
import type { AssessmentData, JobType, OutcomeQuoteRow } from '@/lib/types'

const SYSTEM = `You draft outcome-based quote rows for Australian biohazard remediation jobs.

Return ONLY valid JSON with this shape:
{
  "rows": [
    {
      "areas": ["Kitchen", "Hallway"],
      "outcome_title": "",
      "outcome_description": "",
      "acceptance_criteria": "",
      "price": 0,
      "status": "suggested",
      "included": [""],
      "excluded": [""],
      "assumptions": [""],
      "verification_method": "",
      "metrics": [{"label":"", "value":""}]
    }
  ]
}

Rules:
- Outcome-first language (value/results), not labour breakdown.
- Keep room/area context in each row.
- No graphic detail; professional scientific wording.
- Use target_price_context as a key pricing signal.
- status must be "suggested" for every row.
- price must be >= 0 and represented as number.
`

function safeNumber(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function parseRows(raw: unknown): OutcomeQuoteRow[] {
  const root = raw as { rows?: Array<Record<string, unknown>> }
  const rows = root.rows ?? []
  return rows
    .map((row, idx) => {
      const areasRaw = Array.isArray(row.areas) ? row.areas : []
      const includedRaw = Array.isArray(row.included) ? row.included : []
      const excludedRaw = Array.isArray(row.excluded) ? row.excluded : []
      const assumptionsRaw = Array.isArray(row.assumptions) ? row.assumptions : []
      const metricsRaw = Array.isArray(row.metrics) ? row.metrics : []
      return {
        id: `suggested_${idx + 1}`,
        areas: areasRaw.map(a => String(a ?? '').trim()).filter(Boolean),
        outcome_title: String(row.outcome_title ?? '').trim(),
        outcome_description: String(row.outcome_description ?? '').trim(),
        acceptance_criteria: String(row.acceptance_criteria ?? '').trim(),
        price: Math.max(0, Math.round(safeNumber(row.price, 0) * 100) / 100),
        status: 'suggested',
        included: includedRaw.map(v => String(v ?? '').trim()).filter(Boolean),
        excluded: excludedRaw.map(v => String(v ?? '').trim()).filter(Boolean),
        assumptions: assumptionsRaw.map(v => String(v ?? '').trim()).filter(Boolean),
        verification_method: String(row.verification_method ?? '').trim(),
        metrics: metricsRaw
          .map(m => {
            const x = m as Record<string, unknown>
            return { label: String(x.label ?? '').trim(), value: String(x.value ?? '').trim() }
          })
          .filter(m => m.label || m.value),
      } satisfies OutcomeQuoteRow
    })
    .filter(row => row.outcome_title && row.outcome_description)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })

    const body = (await req.json().catch(() => ({}))) as {
      target_amount?: unknown
      target_price_note?: unknown
    }
    const targetAmount =
      typeof body.target_amount === 'number'
        ? body.target_amount
        : (typeof body.target_amount === 'string' && body.target_amount.trim()
            ? Number(body.target_amount)
            : null)
    if (targetAmount != null && (!Number.isFinite(targetAmount) || targetAmount < 0)) {
      return NextResponse.json({ error: 'target_amount must be a number >= 0' }, { status: 400 })
    }
    const targetPriceNote = typeof body.target_price_note === 'string' ? body.target_price_note.trim() : ''

    const apiKey = getAnthropicApiKey()
    if (!apiKey) return NextResponse.json({ error: 'Anthropic is not configured' }, { status: 503 })
    const client = new Anthropic({ apiKey })

    const { id: jobId } = await params
    const supabase = createServiceClient()
    const { data: job } = await supabase
      .from('jobs')
      .select('id, job_type, urgency, notes, assessment_data')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const ad = (job.assessment_data ?? null) as AssessmentData | null
    const sow = mergedSowCapture(ad)
    const [photosRes, docsRes] = await Promise.all([
      supabase
        .from('photos')
        .select('area_ref, category, caption')
        .eq('job_id', jobId)
        .order('uploaded_at', { ascending: false })
        .limit(150),
      supabase
        .from('documents')
        .select('id, type, created_at')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
        .limit(80),
    ])

    const context = {
      job: {
        id: job.id,
        job_type: job.job_type as JobType,
        urgency: job.urgency ?? null,
        notes: job.notes ?? '',
      },
      assessment_data: ad,
      scope_of_work: {
        objective: sow.objective,
        scope_work: sow.scope_work,
        methodology: sow.methodology,
        timeline: sow.timeline,
        safety: sow.safety,
        waste: sow.waste,
        exclusions: sow.exclusions,
        caveats: sow.caveats,
      },
      target_price_context: {
        target_amount: targetAmount ?? ad?.target_price ?? null,
        target_price_note: targetPriceNote || ad?.target_price_note || '',
      },
      photo_metadata: (photosRes.data ?? []).map((p: { area_ref: string | null; category: string; caption: string | null }) => ({
        area_ref: (p.area_ref ?? '').trim() || null,
        category: p.category,
        caption: (p.caption ?? '').trim() || null,
      })),
      document_metadata: (docsRes.data ?? []).map((d: { id: string; type: string; created_at: string }) => ({
        id: d.id,
        type: d.type,
        created_at: d.created_at,
      })),
    }

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(context) }],
    })
    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 })

    const parsed = JSON.parse(jsonMatch[0]) as unknown
    const rows = parseRows(parsed)
    if (!rows.length) {
      return NextResponse.json({ error: 'AI did not return usable outcome rows' }, { status: 500 })
    }

    return NextResponse.json({ rows })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not suggest quote outcomes' },
      { status: 500 }
    )
  }
}
