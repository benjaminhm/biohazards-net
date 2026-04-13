/*
 * app/api/jobs/[id]/extract-assessment/route.ts
 *
 * POST /api/jobs/[id]/extract-assessment
 *
 * Assessment field extraction from unstructured text (voice memo,
 * email thread, field notes) and returns structured AssessmentData fields.
 *
 * The returned object is merged into existing assessment_data on the client —
 * null values are discarded so existing fields are never overwritten with empties.
 * custom_fields captures anything not in the standard schema (insurance numbers,
 * access codes, coroner status, specialist requirements, etc.).
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id: jobId } = await params
  const supabase = createServiceClient()
  const { data: jobRow } = await supabase
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!jobRow) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const { text } = await req.json()
  if (!text?.trim()) return NextResponse.json({ error: 'No text provided' }, { status: 400 })

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `You are extracting biohazard job assessment details from an email thread, voice memo transcript, or field notes.

Return ONLY valid JSON — no explanation, no markdown, just the JSON object.

Extract what you can find and leave the rest as null or empty. For custom_fields, capture ANYTHING that doesn't fit the standard fields — insurance details, contacts, claim numbers, specialist requirements, access details, next of kin, council notifications, etc.

JSON schema to return:
{
  "contamination_level": <number 1-5 or null>,
  "biohazard_type": "<e.g. Blood, Decomposition, Sewage, Meth, or empty string>",
  "estimated_hours": <number or null>,
  "estimated_waste_litres": <number or null>,
  "access_restrictions": "<string or empty>",
  "manual_location": "<on-site detail supplementing street address: building, unit, rear shed, etc., or empty>",
  "observations": "<freeform notes, site conditions, anything not captured elsewhere>",
  "areas": [
    { "name": "<room/area name>", "sqm": <number or 0>, "hazard_level": <1-5>, "description": "<what was found>" }
  ],
  "ppe_required": {
    "gloves": <true/false>,
    "tyvek_suit": <true/false>,
    "respirator": <true/false>,
    "face_shield": <true/false>,
    "boot_covers": <true/false>,
    "double_bag": <true/false>
  },
  "special_risks": {
    "sharps": <true/false>,
    "chemicals": <true/false>,
    "structural_damage": <true/false>,
    "infectious_disease": <true/false>,
    "vermin": <true/false>,
    "mold_spores": <true/false>
  },
  "custom_fields": [
    { "label": "<field name>", "value": "<field value>" }
  ]
}

Rules:
- contamination_level: 1=minimal, 2=low, 3=moderate, 4=high, 5=extreme/severe
- For PPE and special_risks: only set true if explicitly mentioned or clearly implied
- areas: only include if specific rooms/zones are mentioned
- custom_fields: be generous — capture insurance company, claim numbers, policy numbers, property manager, property owner, agent contacts, funeral director, coroner status, key location, access codes, police report numbers, council requirements, specialist disposal, skip bin needs, anything else mentioned
- manual_location: specific place on the property if mentioned (distinct from street address)
- observations: use for general site conditions, context, and anything that doesn't fit a specific field
- If something is truly not mentioned, use null for numbers or empty string for strings

Text to extract from:
"""
${text}
"""

Return only the JSON object.`
    }]
  })

  const raw = (message.content[0] as { text: string }).text.trim()
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return NextResponse.json({ error: 'Could not parse response' }, { status: 500 })

  try {
    const extracted = JSON.parse(jsonMatch[0])
    return NextResponse.json({ extracted })
  } catch {
    return NextResponse.json({ error: 'Invalid JSON from AI' }, { status: 500 })
  }
}
