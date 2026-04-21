/*
 * POST /api/polish-text
 *
 * Org-scoped, admin-only polish endpoint. Fixes spelling, grammar, and
 * punctuation in free text (e.g. speech transcripts) without adding or
 * changing facts. Mirrors /api/jobs/[id]/polish-text but with no job
 * context — used by rooms that aren't attached to a specific job
 * (currently /brain-dump).
 *
 * AI is backend-only and invisible (see docs/ai-product-principles.md).
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { getOrgId } from '@/lib/org'

const MAX_CHARS = 48_000

const SYSTEM = `You are an editor for internal field notes written by biohazard remediation technicians.

Your ONLY job is to fix spelling, grammar, and punctuation. You must:
- Preserve meaning, facts, numbers, measurements, names, addresses, and technical terms exactly as intended.
- NOT add, remove, or invent information. NOT soften or strengthen clinical or site observations.
- NOT change the voice beyond fixing errors (keep first-person if used).
- Use Australian English spelling where a choice exists (e.g. colour, organise).
- Preserve paragraph breaks and simple lists where they exist.

Output ONLY the corrected text — no title, no preamble, no markdown code fences, no quotation marks around the whole text.`

export async function POST(req: NextRequest) {
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

    const supabase = createServiceClient()
    const { data: orgUser } = await supabase
      .from('org_users')
      .select('role')
      .eq('clerk_user_id', userId)
      .eq('org_id', orgId)
      .single()
    if (!orgUser || orgUser.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { text } = (await req.json()) as { text?: string }
    if (typeof text !== 'string') {
      return NextResponse.json({ error: 'text must be a string' }, { status: 400 })
    }
    const trimmed = text.trim()
    if (!trimmed) {
      return NextResponse.json({ error: 'No text to polish' }, { status: 400 })
    }
    if (text.length > MAX_CHARS) {
      return NextResponse.json({ error: `Text is too long (max ${MAX_CHARS} characters)` }, { status: 400 })
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

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Fix spelling, grammar, and punctuation only. Text:\n\n${text}`,
        },
      ],
    })

    const block = message.content[0]
    const raw = block?.type === 'text' ? block.text.trim() : ''
    if (!raw) {
      return NextResponse.json({ error: 'Empty response from model' }, { status: 500 })
    }

    let out = raw
    if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) {
      out = out.slice(1, -1)
    }
    out = out.replace(/^```[\w]*\s*/i, '').replace(/\s*```$/i, '').trim()

    return NextResponse.json({ text: out })
  } catch (e: unknown) {
    console.error('[polish-text]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Polish failed' },
      { status: 500 }
    )
  }
}
