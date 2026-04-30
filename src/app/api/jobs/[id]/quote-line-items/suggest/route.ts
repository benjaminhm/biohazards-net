import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { mergedSowCapture } from '@/lib/sowCapture'
import type { AssessmentData, JobType, QuoteGstMode } from '@/lib/types'
import {
  QUOTE_SOURCE_SCHEMA_VERSION,
  quoteLineItemSourceHash,
} from '@/lib/quoteLineItemSource'

type DraftItem = { description: string; qty: number; unit: string; weight: number }
type DraftRoom = { room: string; items: DraftItem[] }

const SYSTEM = `You draft quote line items for Australian biohazard remediation jobs.

Output ONLY valid JSON:
{"rooms":[{"room":"","items":[{"description":"","qty":1,"unit":"hrs","weight":1}]}]}

Rules:
- Group by room where possible.
- Descriptions are concrete and work-focused.
- qty must be >= 0; weight must be > 0.
- unit examples: hrs, each, sqm, lot.
- DO NOT include currency symbols.
- DO NOT include totals; weight is for proportional costing.
- TARGETING: Treat target_price_context as a key planning signal for relative workload emphasis and line-item weight allocation.
- If target_subtotal_ex_gst is provided, prefer a practical distribution of effort that can be back-calculated to that target.
`

function gstModeFromRun(run: { gst_mode?: unknown; add_gst_to_total?: boolean } | null): QuoteGstMode {
  if (run?.gst_mode === 'no_gst' || run?.gst_mode === 'inclusive' || run?.gst_mode === 'exclusive') return run.gst_mode
  return run?.add_gst_to_total === true ? 'exclusive' : 'no_gst'
}

function parseTarget(targetPrice: number | null, note: string): { subtotal: number | null } {
  if (targetPrice == null || !Number.isFinite(targetPrice)) return { subtotal: null }
  const n = note.toLowerCase()
  const isEx = n.includes('ex') || n.includes('excl') || n.includes('+ gst') || n.includes('+gst')
  return { subtotal: isEx ? targetPrice : Math.round((targetPrice / 1.1) * 100) / 100 }
}

function safeNum(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function normaliseDraft(parsed: unknown): DraftRoom[] {
  const root = parsed as { rooms?: Array<{ room?: unknown; items?: Array<Record<string, unknown>> }> }
  const rooms = (root.rooms ?? []).map(r => ({
    room: String(r.room ?? '').trim(),
    items: (r.items ?? []).map(it => ({
      description: String(it.description ?? '').trim(),
      qty: Math.max(0, safeNum(it.qty, 1)),
      unit: String(it.unit ?? 'hrs').trim() || 'hrs',
      weight: Math.max(0.01, safeNum(it.weight, 1)),
    })),
  }))
  return rooms
    .filter(r => r.room && r.items.length > 0)
    .map(r => ({ ...r, items: r.items.filter(i => i.description) }))
    .filter(r => r.items.length > 0)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })
    const apiKey = getAnthropicApiKey()
    if (!apiKey) return NextResponse.json({ error: 'Anthropic is not configured' }, { status: 503 })

    const body = (await req.json().catch(() => ({}))) as {
      target_amount?: unknown
      target_price_note?: unknown
    }
    const targetOverride =
      typeof body.target_amount === 'number'
        ? body.target_amount
        : (typeof body.target_amount === 'string' && body.target_amount.trim() !== ''
            ? Number(body.target_amount)
            : null)
    const targetOverrideValid =
      targetOverride == null || (Number.isFinite(targetOverride) && targetOverride >= 0)
    if (!targetOverrideValid) {
      return NextResponse.json({ error: 'target_amount must be a number >= 0' }, { status: 400 })
    }
    const targetNoteOverride =
      typeof body.target_price_note === 'string' ? body.target_price_note.trim() : null

    const { id: jobId } = await params
    const supabase = createServiceClient()
    const { data: job } = await supabase
      .from('jobs')
      .select('id, job_type, assessment_data, notes')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const ad = (job.assessment_data ?? null) as AssessmentData | null
    const sow = mergedSowCapture(ad)
    const scopeText = [
      sow.objective,
      sow.scope_work,
      sow.methodology,
      sow.timeline,
      sow.safety,
      sow.waste,
      sow.exclusions,
      sow.caveats,
    ].join('\n').trim()
    if (!scopeText) {
      return NextResponse.json(
        { error: 'Add Scope of Work capture first, then generate line items.' },
        { status: 400 }
      )
    }

    const targetPrice = targetOverride ?? ad?.target_price ?? null
    const targetPriceNote = targetNoteOverride ?? ad?.target_price_note ?? ''
    const sourceState = quoteLineItemSourceHash({
      job_type: job.job_type as JobType,
      notes: job.notes ?? '',
      assessment_data: ad,
    })

    const { subtotal: targetSubtotalExGst } = parseTarget(targetPrice, targetPriceNote)
    const userBlock = JSON.stringify({
      ...sourceState.source,
      target_price_context: {
        target_amount: targetPrice,
        target_price_note: targetPriceNote,
        target_subtotal_ex_gst: targetSubtotalExGst,
      },
    })

    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: 'user', content: userBlock }],
    })
    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 })
    const parsed = JSON.parse(jsonMatch[0]) as unknown
    const draft = normaliseDraft(parsed)
    if (!draft.length) {
      return NextResponse.json({ error: 'AI did not return usable line items' }, { status: 500 })
    }

    const subtotal = targetSubtotalExGst
    const all = draft.flatMap(r => r.items.map(i => ({ room: r.room, ...i })))
    const totalWeight = all.reduce((s, i) => s + i.weight * Math.max(0.1, i.qty), 0) || 1

    const { data: prevActive } = await supabase
      .from('quote_line_item_runs')
      .select('*')
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .maybeSingle()
    const preserveGstMode = gstModeFromRun(prevActive as { gst_mode?: unknown; add_gst_to_total?: boolean } | null)

    // Regenerate replaces current active suggestions.
    await supabase
      .from('quote_line_item_runs')
      .update({ is_active: false })
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .eq('is_active', true)

    const runRes = await supabase
      .from('quote_line_item_runs')
      .insert({
        org_id: orgId,
        job_id: jobId,
        target_amount: targetPrice,
        target_price_note: targetPriceNote,
        gst_mode: preserveGstMode,
        add_gst_to_total: preserveGstMode === 'exclusive',
        is_active: true,
        source_hash: sourceState.hash,
        source_schema_version: QUOTE_SOURCE_SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        generated_by_user_id: userId,
        created_by_user_id: userId,
      })
      .select()
      .single()
    if (runRes.error) throw runRes.error
    const run = runRes.data

    const rows = all.map((item, idx) => {
      const share = (item.weight * Math.max(0.1, item.qty)) / totalWeight
      const lineTotal = subtotal != null
        ? Math.max(0, Math.round(subtotal * share * 100) / 100)
        : Math.max(0, Math.round(item.qty * 150 * item.weight * 100) / 100)
      const rate = item.qty > 0 ? Math.round((lineTotal / item.qty) * 100) / 100 : 0
      return {
        run_id: run.id,
        org_id: orgId,
        job_id: jobId,
        room_name: item.room,
        description: item.description,
        qty: item.qty,
        unit: item.unit,
        rate,
        total: Math.round(item.qty * rate * 100) / 100,
        sort_order: idx,
        source: 'ai',
        created_by_user_id: userId,
        updated_by_user_id: userId,
      }
    })

    const itemsRes = await supabase.from('quote_line_items').insert(rows).select('*')
    if (itemsRes.error) throw itemsRes.error

    return NextResponse.json({
      run,
      items: itemsRes.data ?? [],
      pricing_basis: subtotal != null ? 'target_back_calculated_subtotal' : 'default_rate_model',
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not suggest line items' },
      { status: 500 }
    )
  }
}
