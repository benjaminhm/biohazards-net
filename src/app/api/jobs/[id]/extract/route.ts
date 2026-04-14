/*
 * app/api/jobs/[id]/extract/route.ts
 *
 * POST /api/jobs/[id]/extract
 *
 * SmartFill extraction for job details (client name, phone, address, job type,
 * urgency). Accepts raw text (email, voicemail transcript, note) and returns
 * structured fields via Claude.
 *
 * Used by the SmartFill component on the Details tab and New Job form.
 * For assessment-specific extraction, see extract-assessment/route.ts.
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
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Extract contact and job details from this message. Return ONLY valid JSON with these fields (use empty string if not found):

{
  "client_name": "primary contact person first and last name (the person you would call)",
  "client_organization_name": "company or legal client name if the contact works for an organisation",
  "client_contact_role": "their role if stated e.g. property manager, son, insurer",
  "client_contact_relationship": "relationship to the site or incident e.g. tenant, owner, family member of occupant",
  "insurance_claim_ref": "insurance claim number or reference if mentioned",
  "client_phone": "phone number",
  "client_email": "email address",
  "site_address": "full site address where the job is located",
  "job_type": "one of: crime_scene | hoarding | mold | sewage | trauma | unattended_death | flood | other",
  "urgency": "one of: standard | urgent | emergency",
  "company_name": "deprecated alias for client_organization_name — prefer client_organization_name"
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
