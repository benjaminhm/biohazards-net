import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await params
  const { text } = await req.json()
  if (!text?.trim()) return NextResponse.json({ error: 'No text provided' }, { status: 400 })

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Extract contact and job details from this message. Return ONLY valid JSON with these fields (use empty string if not found):

{
  "client_name": "first and last name of the contact",
  "client_phone": "phone number",
  "client_email": "email address",
  "site_address": "full site address where the job is located",
  "job_type": "one of: crime_scene | hoarding | mold | sewage | trauma | unattended_death | flood | other",
  "urgency": "one of: standard | urgent | emergency",
  "company_name": "company or business name if mentioned"
}

For job_type: infer from context (e.g. 'unattended death', 'decomposition' → unattended_death, 'hoarding cleanup' → hoarding).
For urgency: infer from context (e.g. 'been there a week', 'urgent', 'ASAP' → urgent, 'emergency' → emergency, otherwise standard).

Message:
"""
${text}
"""

Return only the JSON object. No explanation.`
    }]
  })

  const raw = (message.content[0] as { text: string }).text.trim()
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return NextResponse.json({ error: 'Could not parse response' }, { status: 500 })

  const extracted = JSON.parse(jsonMatch[0])
  return NextResponse.json({ extracted })
}
