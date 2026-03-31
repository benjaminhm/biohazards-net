import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { DocType } from '@/lib/types'

const client = new Anthropic()

export async function POST(req: Request) {
  try {
    const { type, content, message } = await req.json() as {
      type: DocType
      content: Record<string, unknown>
      message: string
    }

    if (!type || !content || !message) {
      return NextResponse.json({ error: 'type, content and message are required' }, { status: 400 })
    }

    const systemPrompt = `You are an expert document editor helping a biohazard remediation company edit professional documents.

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
