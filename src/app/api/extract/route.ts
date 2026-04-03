/*
 * app/api/extract/route.ts
 *
 * POST /api/extract — SmartFill extraction for the new-job creation form.
 * Accepts freeform text (email, SMS, voicemail transcript) and returns
 * structured job fields via Claude.
 *
 * Used by the SmartFill component on /new-client and /jobs/new.
 * For extraction within an existing job's Details tab, see
 * /api/jobs/[id]/extract. Both routes use the same prompt logic.
 *
 * The regex /\{[\s\S]*\}/ extracts the JSON object from Claude's response
 * even if there is surrounding text — defensive against verbose completions.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
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
  "client_phone": "phone number in Australian format",
  "client_email": "email address",
  "site_address": "full site address where the job is located",
  "job_type": "one of: crime_scene | hoarding | mold | sewage | trauma | unattended_death | flood | other",
  "urgency": "one of: standard | urgent | emergency",
  "company_name": "company or business name if mentioned"
}

Rules:
- job_type: infer from context (e.g. decomposition/body → unattended_death, hoarding cleanup → hoarding, mould/mold → mold)
- urgency: emergency = immediate danger/active scene, urgent = within days/ASAP/been there a while, standard = routine/no rush
- site_address: extract property address not mailing address
- client_name: person contacting you, not company name

Message:
"""
${text}
"""

Return only the JSON object. No explanation. No markdown.`
    }]
  })

  const raw = (message.content[0] as { text: string }).text.trim()
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return NextResponse.json({ error: 'Could not parse response' }, { status: 500 })

  const extracted = JSON.parse(jsonMatch[0])
  return NextResponse.json({ extracted })
}
