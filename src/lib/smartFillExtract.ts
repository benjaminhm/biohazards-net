/*
 * lib/smartFillExtract.ts
 *
 * Smart Fill: turn freeform intake text (email, SMS, voicemail transcript) into
 * structured job fields with Claude. Staff review the result before it is
 * applied. Used by POST /api/extract (staff session) and
 * POST /api/photo/newjob/extract (photo PIN).
 *
 * The regex /\{[\s\S]*\}/ extracts the JSON object from Claude's response
 * even if there is surrounding text — defensive against verbose completions.
 */
import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/** Returns the extracted fields, or null when the response could not be read. */
export async function extractIntakeFields(text: string): Promise<Record<string, string> | null> {
  const message = await client.messages.create({
    model: CLAUDE_SONNET_MODEL,
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
  if (!jsonMatch) return null
  return JSON.parse(jsonMatch[0])
}
