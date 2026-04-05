/*
 * app/api/chat-document/route.ts
 *
 * POST /api/chat-document — conversational document editing via Claude.
 * Accepts a natural-language instruction and the current document JSON,
 * returns { reply, content } where:
 *   - reply: 1-2 sentence confirmation of what was changed
 *   - content: the updated document JSON (same structure as input)
 *
 * Used by the document editor chat bar in GenerateModal and the doc editor page.
 * The system prompt instructs Claude to return a wrapper JSON containing both
 * the reply and the updated content, parsed with /\{[\s\S]*\}/ regex.
 *
 * Document rules (biohazards.md) are optionally injected if provided in the
 * request, ensuring edits respect org-specific style guidelines.
 */
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import type { DocType } from '@/lib/types'
import { getOrgId } from '@/lib/org'

const client = new Anthropic()

export async function POST(req: Request) {
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

    const { type, content, message, rules } = await req.json() as {
      type: DocType
      content: Record<string, unknown>
      message: string
      rules?: string
    }

    if (!type || !content || !message) {
      return NextResponse.json({ error: 'type, content and message are required' }, { status: 400 })
    }

    const rulesBlock = rules?.trim()
      ? `\nDOCUMENT RULES (biohazards.md — follow these strictly when rewriting content):\n${rules.trim()}\n`
      : ''

    const systemPrompt = `You are an expert document editor helping a biohazard remediation company edit professional documents.
${rulesBlock}
The user will give you instructions to modify a ${type} document. You must:
1. Apply the instruction to the document content
2. Return the complete updated document as JSON (same structure as input)
3. Write a SHORT reply (1-2 sentences max) confirming what you changed

Respond ONLY with this JSON structure — no markdown, no other text:
{
  "reply": "Short confirmation of what was changed",
  "content": { ...full updated document object... }
}

Keep the same JSON keys and structure. Only change the values the user asked about.
Write in a professional, confident tone appropriate for Australian biohazard remediation.`

    const message_ = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Current document content:\n${JSON.stringify(content, null, 2)}\n\nInstruction: ${message}`,
        },
      ],
    })

    const text = message_.content[0].type === 'text' ? message_.content[0].text.trim() : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON returned from Claude')

    const result = JSON.parse(jsonMatch[0])
    return NextResponse.json({ reply: result.reply, content: result.content })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
