/*
 * app/api/brain-dump/structure/route.ts
 *
 * POST /api/brain-dump/structure
 *
 * The heart of the Brain Dump feature: take a raw staff dump (dictated or
 * pasted freeform text) and have Claude split it into discrete, atomic
 * items bucketed as todo | reminder | note | moment. Each parse is stored
 * in brain_dump_captures for audit, and each returned item is inserted into
 * brain_dump_items so the /brain-dump room's living list picks it up.
 *
 * HITL: items come in as 'open' status — the admin reviews, edits, and
 * deletes from the UI. Nothing is sent anywhere. Reminders carry a due_at
 * but are NOT wired to any scheduler yet.
 *
 * Admin only, per-user scoped — every row is stamped with
 * owner_user_id = caller so two admins in the same org never mix lists.
 * AI is backend-only and invisible per docs/ai-product-principles.md.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { guardBrainDump } from '@/lib/brainDump/guard'
import { getClerkFirstName } from '@/lib/clerkDisplayName'

const MAX_INPUT = 20_000
const ALLOWED_KINDS = ['todo', 'reminder', 'note', 'moment'] as const
type BrainDumpKind = (typeof ALLOWED_KINDS)[number]

interface ParsedItem {
  kind: BrainDumpKind
  text: string
  due_at: string | null
  priority: 0 | 1 | 2
  tags: string[]
}

export async function POST(req: NextRequest) {
  const guard = await guardBrainDump(req)
  if (!guard.ok) return guard.response
  const { userId, orgId, supabase } = guard.ctx

  let body: { text?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const text = (body.text ?? '').trim()
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 })
  if (text.length > MAX_INPUT) {
    return NextResponse.json({ error: `text too long (max ${MAX_INPUT})` }, { status: 400 })
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

  const anthropic = new Anthropic({ apiKey })
  const nowIso = new Date().toISOString()

  let parsed: ParsedItem[] = []
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: buildPrompt(text, nowIso),
        },
      ],
    })

    const block = message.content[0]
    const raw = block?.type === 'text' ? block.text.trim() : ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 })
    }
    const obj = JSON.parse(jsonMatch[0]) as { items?: unknown }
    parsed = normaliseItems(obj.items)
  } catch (err) {
    console.error('[brain-dump/structure]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI structure failed' },
      { status: 500 }
    )
  }

  if (parsed.length === 0) {
    return NextResponse.json({ error: 'AI returned no items' }, { status: 500 })
  }

  const firstName = await getClerkFirstName(userId)

  const { data: capture, error: captureErr } = await supabase
    .from('brain_dump_captures')
    .insert({
      org_id: orgId,
      owner_user_id: userId,
      raw_text: text,
      item_count: parsed.length,
      created_by_user_id: userId,
      created_by_first_name: firstName,
    })
    .select('id')
    .single()

  if (captureErr || !capture) {
    return NextResponse.json(
      { error: captureErr?.message ?? 'Could not save capture' },
      { status: 500 }
    )
  }

  const rows = parsed.map(p => ({
    org_id: orgId,
    owner_user_id: userId,
    capture_id: capture.id,
    kind: p.kind,
    status: 'open' as const,
    text: p.text,
    due_at: p.due_at,
    priority: p.priority,
    tags: p.tags,
    created_by_user_id: userId,
    updated_by_user_id: userId,
    created_by_first_name: firstName,
  }))

  const { data: inserted, error: insertErr } = await supabase
    .from('brain_dump_items')
    .insert(rows)
    .select()

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json(
    { capture_id: capture.id, items: inserted ?? [] },
    { status: 201 }
  )
}

function buildPrompt(text: string, nowIso: string) {
  return `You are parsing an internal staff brain-dump (voice memo transcript or pasted notes) for a biohazard cleaning business in Australia. Split it into atomic, discrete items.

Return ONLY valid JSON — no explanation, no markdown, no code fences:

{
  "items": [
    {
      "kind": "todo" | "reminder" | "note" | "moment",
      "text": "<single concise sentence>",
      "due_at": "<ISO 8601 datetime or null>",
      "priority": 0 | 1 | 2,
      "tags": ["<short lowercase tag>", ...]
    }
  ]
}

Rules:
- "todo": an action the speaker intends to do ("call the landlord", "order more tyvek suits").
- "reminder": anything with a time or date cue ("on Tuesday", "before Friday", "at 3pm", "next week"). Resolve relative dates against ${nowIso} (Australia timezone). If the cue is vague (e.g. "soon", "later"), leave due_at null and mark it as a todo instead.
- "moment": a thing that happened worth remembering — an observation, insight, anecdote, site detail.
- "note": anything else — reference info, phone numbers, prices, ideas, addresses.
- Split compound sentences ("call Bob and order gloves" → two items).
- Keep each item atomic and self-contained. Do NOT merge unrelated thoughts.
- priority: 2 = explicit urgency ("urgent", "ASAP", "right now"), 1 = soft deadline or important ("don't forget", "before end of week"), 0 = default.
- tags: 0–4 short lowercase tags that help filter later (e.g. "supplier", "admin", "client:smith", "ppe"). Never invent names or IDs that weren't in the text.
- Do not invent facts. If a kind is ambiguous, prefer "note".
- If the dump contains nothing structured (e.g. it's a single short note), return one note item with the text roughly as-is.

Text to parse:
"""
${text}
"""

Return only the JSON object.`
}

function normaliseItems(raw: unknown): ParsedItem[] {
  if (!Array.isArray(raw)) return []
  const out: ParsedItem[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const r = entry as Record<string, unknown>

    const textRaw = typeof r.text === 'string' ? r.text.trim() : ''
    if (!textRaw) continue
    const text = textRaw.slice(0, 4000)

    const kindRaw = typeof r.kind === 'string' ? r.kind.toLowerCase() : ''
    const kind: BrainDumpKind = (ALLOWED_KINDS as readonly string[]).includes(kindRaw)
      ? (kindRaw as BrainDumpKind)
      : 'note'

    let due_at: string | null = null
    if (typeof r.due_at === 'string' && r.due_at.trim()) {
      const t = new Date(r.due_at).getTime()
      if (Number.isFinite(t)) due_at = new Date(t).toISOString()
    }

    let priority: 0 | 1 | 2 = 0
    if (typeof r.priority === 'number') {
      if (r.priority >= 2) priority = 2
      else if (r.priority >= 1) priority = 1
    }

    const tags = Array.isArray(r.tags)
      ? r.tags
          .filter((t): t is string => typeof t === 'string')
          .map(t => t.trim().toLowerCase().slice(0, 40))
          .filter(Boolean)
          .slice(0, 6)
      : []

    out.push({ kind, text, due_at, priority, tags })
  }
  return out
}
