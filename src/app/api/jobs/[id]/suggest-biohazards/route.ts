/*
 * POST /api/jobs/[id]/suggest-biohazards
 *
 * Staff-only: reads presenting risks and suggests additional hazard themes. Persists
 * assessment_data.suggested_biohazards_ai (field name unchanged).
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { allRiskChipItems } from '@/lib/documentGenerationDrivers'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { loadOrgVocabulary } from '@/lib/orgVocabularyLoader'
import { orgVocabularyBlock } from '@/lib/orgVocabulary'
import type { AssessmentData, JobType, SuggestedRiskAiItem, SuggestedRiskCategory } from '@/lib/types'

const CATEGORIES: SuggestedRiskCategory[] = [
  'biological',
  'chemical',
  'physical',
  'environmental',
  'operational',
]

function slugId(label: string, i: number) {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48)
  return s || `bh_${i}`
}

function normalizeItem(raw: { id?: string; label?: string; category?: string }, i: number): SuggestedRiskAiItem | null {
  const label = (raw.label ?? '').trim()
  if (!label || label.length > 120) return null
  const cat = (raw.category ?? '').toLowerCase() as SuggestedRiskCategory
  const category = CATEGORIES.includes(cat) ? cat : 'operational'
  const id = (raw.id ?? '').trim() || slugId(label, i)
  return { id: id.slice(0, 64), label: label.slice(0, 120), category }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organisation inactive or you have no active organisation' },
        { status: 403 }
      )
    }

    const apiKey = getAnthropicApiKey()
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'Anthropic is not configured: set ANTHROPIC_API_KEY in .env.local (see .env.local.example), then restart the dev server.',
        },
        { status: 503 }
      )
    }
    const client = new Anthropic({ apiKey })

    const { id: jobId } = await params
    const supabase = createServiceClient()

    const jobRes = await supabase
      .from('jobs')
      .select('id, job_type, site_address, assessment_data')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (!jobRes.data) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const job = jobRes.data as { id: string; job_type: JobType; site_address: string; assessment_data: AssessmentData | null }
    const ad = job.assessment_data

    const presentingIds = new Set(ad?.presenting_risk_ids ?? [])
    const riskItems = allRiskChipItems(ad)
    const presentingRisks = riskItems.filter(r => presentingIds.has(r.id))

    if (presentingRisks.length === 0) {
      return NextResponse.json(
        {
          error:
            'No presenting risks yet. On the Risks tab, move at least one risk into Presenting risks, then try again.',
        },
        { status: 400 }
      )
    }

    const payload = {
      job_type: job.job_type,
      site_address: job.site_address,
      biohazard_type: (ad?.biohazard_type || '').trim() || null,
      presenting_risks: presentingRisks.map(r => ({
        id: r.id,
        label: r.label,
        category: r.category,
      })),
    }

    const userBlock = JSON.stringify(payload, null, 2)

    const vocabulary = await loadOrgVocabulary(supabase, orgId, { kinds: ['health_hazard'] })
    const vocabularyBlock = orgVocabularyBlock('health_hazard', vocabulary.health_hazard)

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You assist biohazard remediation and specialist cleaning technicians in Australia.

You receive JSON: job context plus "presenting risks" already accepted on the Risks tab.

Propose DISTINCT additional HAZARD themes as SHORT labels (2–7 words each) implied by those risks — biological, chemical, physical, environmental, or operational (including manual handling, slips/trips, access, communication when relevant).

Rules:
- Base suggestions on presenting risk labels and job context only. Do not invent site-specific incidents not implied by the input.
- Choose category: biological, chemical, physical, environmental, or operational per label.
- Each item: "label" (concise), "category" must be exactly one of: biological, chemical, physical, environmental, operational.
- Optional "id": short snake_case slug; if omitted the server will derive one.
- Maximum 18 suggestions. No duplicates. No long sentences.

Respond ONLY with valid JSON in this exact shape (no markdown fences):
{"suggestions":[{"label":"...","category":"physical","id":"optional_slug"}]}

${vocabularyBlock}`,
      messages: [
        {
          role: 'user',
          content: `From these presenting risks, list suggested hazard themes:\n\n${userBlock}`,
        },
      ],
    })

    const block = message.content[0]
    const rawText = block?.type === 'text' ? block.text.trim() : ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 })
    }

    let parsed: { suggestions?: unknown }
    try {
      parsed = JSON.parse(jsonMatch[0]) as { suggestions?: unknown }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON from AI' }, { status: 500 })
    }

    const list = Array.isArray(parsed.suggestions) ? parsed.suggestions : []
    const items: SuggestedRiskAiItem[] = []
    const seen = new Set<string>()
    for (let i = 0; i < list.length && items.length < 18; i++) {
      const n = normalizeItem(list[i] as { id?: string; label?: string; category?: string }, i)
      if (!n) continue
      const key = n.label.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      items.push(n)
    }

    const suggested_biohazards_ai = {
      items,
      generated_at: new Date().toISOString(),
    }

    const itemIdSet = new Set([
      ...items.map(i => i.id),
      ...(ad?.identified_biohazards_ai?.items ?? []).map(i => i.id),
      ...(ad?.manual_biohazard_chips ?? []).map(i => i.id),
    ])
    const presenting_biohazard_ids = (ad?.presenting_biohazard_ids ?? []).filter(id => itemIdSet.has(id))

    const nextAssessment: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      suggested_biohazards_ai,
      presenting_biohazard_ids,
    }

    const { data: updated, error } = await supabase
      .from('jobs')
      .update({
        assessment_data: nextAssessment,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ job: updated, suggested_biohazards_ai })
  } catch (e: unknown) {
    console.error('[suggest-biohazards]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Suggest hazards failed' },
      { status: 500 }
    )
  }
}
