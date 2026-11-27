/*
 * POST /api/jobs/:id/surface-area-scope-draft
 *
 * Staff-only. Drafts the scope of work of the Surface Area Cleaning Quote from the
 * presentation, objective, rooms, ceiling setting, and exclusions on the tab.
 * The draft is shown to staff to review, use, edit, or discard. Nothing is saved or sent here.
 *
 * See docs/ai-product-principles.md.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/staffAuth'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { getOrgId } from '@/lib/org'
import { createServiceClient } from '@/lib/supabase'
import {
  normalizeSurfaceAreaCleaningCapture,
  normalizeSurfaceAreaCleaningStandards,
} from '@/lib/surfaceAreaCleaningQuote'
import {
  SURFACE_AREA_DRAFT_GAP_LABELS,
  SURFACE_AREA_SCOPE_DRAFT_SYSTEM,
  acceptSurfaceAreaScopeDraft,
  hasSurfaceAreaScopeInputs,
  surfaceAreaScopeDraftPayload,
  surfaceAreaScopeDraftSchema,
} from '@/lib/surfaceAreaScopeDraft'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orgId } = await getOrgId(req, userId)
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organisation inactive or you have no active organisation' },
        { status: 403 },
      )
    }

    const { id: jobId } = await params
    const supabase = createServiceClient()
    const { data: jobRow, error: jobErr } = await supabase
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (jobErr) throw jobErr
    if (!jobRow) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const body = (await req.json()) as { capture?: unknown }
    const capture = normalizeSurfaceAreaCleaningCapture(body.capture)
    if (!hasSurfaceAreaScopeInputs(capture)) {
      return NextResponse.json(
        { error: 'Enter a presentation or objective before generating the scope of work.' },
        { status: 400 },
      )
    }

    const { data: company } = await supabase
      .from('company_profile')
      .select('surface_area_cleaning_standards')
      .eq('org_id', orgId)
      .maybeSingle()
    const standards = normalizeSurfaceAreaCleaningStandards(company?.surface_area_cleaning_standards ?? null)

    const apiKey = getAnthropicApiKey()
    if (!apiKey) return NextResponse.json({ error: 'Drafting is unavailable right now.' }, { status: 503 })

    const client = new Anthropic({ apiKey })
    const ask = async (messages: Anthropic.MessageParam[]) => {
      const message = await client.messages.create({
        model: CLAUDE_SONNET_MODEL,
        max_tokens: 4000,
        temperature: 0.2,
        system: SURFACE_AREA_SCOPE_DRAFT_SYSTEM,
        messages,
        output_config: {
          format: {
            type: 'json_schema',
            schema: surfaceAreaScopeDraftSchema(),
          },
        },
      })
      const block = message.content.find(part => part.type === 'text')
      const text = block?.type === 'text' ? block.text : ''
      return {
        text,
        draft: text
          ? acceptSurfaceAreaScopeDraft(JSON.parse(text) as unknown, { excludeCeiling: capture.exclude_ceiling })
          : null,
      }
    }

    const opening: Anthropic.MessageParam = {
      role: 'user',
      content: JSON.stringify(surfaceAreaScopeDraftPayload(capture, standards)),
    }
    const first = await ask([opening])
    let draft = first.draft

    if (first.draft && first.draft.weak.length > 0) {
      const fixes = first.draft.weak
        .map(step => `- "${step.line}" is missing ${SURFACE_AREA_DRAFT_GAP_LABELS[step.gap]}.`)
        .join('\n')
      try {
        const second = await ask([
          opening,
          { role: 'assistant', content: first.text },
          {
            role: 'user',
            content: `These scope steps need tightening:\n${fixes}\nReturn all steps again, rewritten so each step clearly states where, what, and how (and observable pass criteria for verification), grounded in the presentation and objective.`,
          },
        ])
        if (second.draft && second.draft.weak.length < first.draft.weak.length) {
          draft = second.draft
        }
      } catch (e: unknown) {
        console.error('[surface-area-scope-draft] retry', e)
      }
    }

    if (!draft) {
      return NextResponse.json({ error: 'The draft was not usable. Try again.' }, { status: 502 })
    }
    return NextResponse.json({
      scope: draft.scope,
      weak: draft.weak,
      dropped: draft.dropped,
    })
  } catch (e: unknown) {
    console.error('[surface-area-scope-draft]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'The scope could not be drafted' },
      { status: 500 },
    )
  }
}
