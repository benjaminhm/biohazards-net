import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const TYPE_LABELS: Record<string, string> = {
  quote: 'Quote',
  sow: 'Scope of Work',
  report: 'Completion Report',
}

export async function POST(req: Request) {
  try {
    const { type, content, instruction } = await req.json()
    if (!instruction?.trim()) {
      return NextResponse.json({ error: 'No instruction provided' }, { status: 400 })
    }

    const msg = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `You are editing a ${TYPE_LABELS[type] ?? type} document for a biohazard cleaning business.

Current document JSON:
${JSON.stringify(content, null, 2)}

Instruction: ${instruction}

Apply the instruction and return the updated document as valid JSON only — no explanation, no markdown fences, just the raw JSON object.`,
      }],
    })

    const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    const updated = JSON.parse(cleaned)

    return NextResponse.json({ content: updated })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
