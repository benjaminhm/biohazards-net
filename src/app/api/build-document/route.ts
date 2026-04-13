/*
 * app/api/build-document/route.ts
 *
 * POST /api/build-document — primary document generation endpoint.
 * Generates all DocType documents using Claude claude-sonnet-4-6.
 *
 * Architecture:
 * - Job + photos + company profile are passed in the request body (not fetched
 *   here) so the caller controls what data Claude sees.
 * - jobContext() compiles all assessment data, photo notes, company info,
 *   pricing, and HITL chip lists (see lib/documentGenerationDrivers.ts) into
 *   a structured text block injected into every prompt.
 * - schemas{} contains per-DocType JSON structure instructions — Claude must
 *   return exactly matching keys to be renderable by printDocument.ts.
 * - getDocumentRulesForBuild() injects code baseline, DB platform_document_rules,
 *   then per-org company_profile.document_rules (see lib/documentRules.ts).
 * - Style PDFs: platform document_rules[type + '_pdf'] (if set) is attached first;
 *   company document_rules[type + '_pdf'] second — org example takes precedence in prompt text.
 * - The response regex /\{[\s\S]*\}/ extracts JSON from Claude's reply even
 *   if there is surrounding text.
 *
 * GST calculation (quotes): target_price_note is checked for "ex"/"+ gst"
 * keywords to determine if the target is ex-GST or inc-GST, then the
 * appropriate subtotal/GST/total split is computed before sending to Claude
 * so the numbers are exact.
 */
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@clerk/nextjs/server'
import type { DocType, Job, Photo, CompanyProfile } from '@/lib/types'
import { getOrgId } from '@/lib/org'
import { groupPhotosByRoomAndStage } from '@/lib/photoGroups'
import { getDocumentRulesForBuild } from '@/lib/documentRules'
import { fetchPlatformDocumentRules, type PlatformDocumentRulesMap } from '@/lib/platformDocumentRules'
import {
  documentDriverInstructions,
  hitlSelectionsBlock,
  validateBuildDocument,
} from '@/lib/documentGenerationDrivers'
import { staffSowCaptureBlock } from '@/lib/sowCapture'
import { staffAssessmentDocumentBlock } from '@/lib/assessmentDocumentCapture'

const client = new Anthropic()

/* Generates a human-readable document reference (e.g. QTE-20250401-AB12CD)
   using a per-type prefix + YYYYMMDD + first 6 chars of job UUID. */
function ref(type: DocType, job: Job): string {
  const prefix: Record<DocType, string> = {
    iaq_multi: 'IAQ',
    quote: 'QTE', sow: 'SOW', assessment_document: 'ASD', swms: 'SWMS', authority_to_proceed: 'ATP',
    engagement_agreement: 'ENG', report: 'RPT', certificate_of_decontamination: 'COD',
    waste_disposal_manifest: 'WDM', jsa: 'JSA', nda: 'NDA', risk_assessment: 'RA',
  }
  const d = new Date()
  return `${prefix[type]}-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${job.id.slice(0,6).toUpperCase()}`
}

function jobContext(job: Job, photos: Photo[], company: CompanyProfile | null): string {
  const a = job.assessment_data
  const ppeList = a ? Object.entries(a.ppe_required).filter(([,v])=>v).map(([k])=>k.replace(/_/g,' ')).join(', ') : 'standard PPE'
  const riskList = a ? Object.entries(a.special_risks).filter(([,v])=>v).map(([k])=>k.replace(/_/g,' ')).join(', ') : 'none identified'
  const areaList = a?.areas?.map(ar=>`${ar.name} (${ar.sqm}m², hazard level ${ar.hazard_level}/5): ${ar.description}${ar.note ? ` | Room note: ${ar.note}` : ''}`).join('\n') ?? 'not specified'
  const photoGroups = groupPhotosByRoomAndStage(photos, a?.areas ?? [])
  const photoNotes = photoGroups.length
    ? photoGroups.map(group => {
      const lines: string[] = [`${group.room.toUpperCase()}:${group.note ? ` Room note: ${group.note}` : ''}`]
      for (const stage of ['assessment', 'before', 'during', 'after'] as const) {
        for (const p of group.stages[stage]) {
          if (p.caption?.trim()) lines.push(`- [${stage.toUpperCase()}] ${p.caption.trim()}`)
        }
      }
      return lines.join('\n')
    }).join('\n\n')
    : 'none'

  return `
COMPANY: ${company?.name ?? 'Brisbane Biohazard Cleaning'} | ABN: ${company?.abn ?? ''} | Phone: ${company?.phone ?? ''} | Licence: ${company?.licence ?? ''}
ADDRESS: ${company?.address ?? 'Brisbane, QLD'}

CLIENT: ${job.client_name}
SITE: ${job.site_address}
JOB TYPE: ${job.job_type.replace(/_/g,' ')}
URGENCY: ${job.urgency}
NOTES: ${job.notes || 'none'}

ASSESSMENT:
- Contamination level: ${a?.contamination_level ?? '?'}/5
- Biohazard type: ${a?.biohazard_type ?? 'not specified'}
- Estimated hours: ${a?.estimated_hours ?? '?'}
- Estimated waste: ${a?.estimated_waste_litres ?? '?'} litres
- Access restrictions: ${a?.access_restrictions || 'none'}
- Manual location (on site): ${a?.manual_location || 'none'}
- Observations: ${a?.observations || 'none'}
- PPE required: ${ppeList}
- Special risks: ${riskList}
- Target price: ${a?.target_price ? `$${a.target_price} ${a.target_price_note || 'inc. GST'}` : 'market rate'}
- Payment terms: ${a?.payment_terms || '50% deposit, remainder on completion net 7 days'}

AREAS:
${areaList}

PHOTO NOTES:
${photoNotes}

${staffSowCaptureBlock(a) || 'SCOPE OF WORK — STAFF CAPTURE: (none entered yet)'}

${staffAssessmentDocumentBlock(a) || 'ASSESSMENT DOCUMENT — STAFF CAPTURE: (none entered yet)'}

${hitlSelectionsBlock(a)}
`.trim()
}

function buildPrompt(
  type: DocType,
  job: Job,
  photos: Photo[],
  company: CompanyProfile | null,
  platformDbRules: PlatformDocumentRulesMap
): string {
  const ctx = jobContext(job, photos, company)
  const d = new Date().toLocaleDateString('en-AU', { day:'numeric', month:'long', year:'numeric' })
  const r = ref(type, job)

  const schemas: Record<DocType, string> = {
    quote: `Return ONLY valid JSON matching this exact structure — no markdown, no explanation:
{
  "title": "Biohazard Remediation Quote — [client name]",
  "reference": "${r}",
  "intro": "2-3 sentence professional introduction covering scope and confidence",
  "line_items": [{"description":"...","qty":0,"unit":"hrs","rate":0,"total":0}],
  "subtotal": 0, "gst": 0, "total": 0,
  "notes": "any site-specific conditions or inclusions/exclusions",
  "payment_terms": "${job.assessment_data?.payment_terms || '50% deposit required to confirm booking. Remainder payable on completion within 7 days. EFT preferred.'}",
  "validity": "This quote is valid for 30 days from the date of issue.",
  "completed_by": ""
}
PRICING: ${(() => {
  const a = job.assessment_data
  const tp = a?.target_price
  if (!tp) return `Use Australian market rates ($120–$250/hr). Ensure subtotal + 10% GST = total.`
  const note = (a?.target_price_note || '').toLowerCase()
  const isEx = note.includes('ex') || note.includes('+gst') || note.includes('+ gst')
  const sub = isEx ? tp : Math.round(tp/1.1*100)/100
  const gst = isEx ? Math.round(tp*0.1*100)/100 : Math.round((tp-sub)*100)/100
  const total = isEx ? Math.round((tp+gst)*100)/100 : tp
  return `Target is $${tp} (${a?.target_price_note||'inc. GST'}). Set subtotal:${sub}, gst:${gst}, total:${total}. Work line items backward from subtotal.`
})()}`,

    sow: `Return ONLY valid JSON:
{
  "title": "Scope of Work — [client name]",
  "reference": "${r}",
  "executive_summary": "...",
  "scope": "detailed paragraph of exactly what will be done",
  "methodology": "step-by-step methodology paragraph",
  "safety_protocols": "PPE, containment, decontamination protocols",
  "waste_disposal": "how biohazardous waste will be packaged, transported, disposed",
  "timeline": "expected duration and milestones",
  "exclusions": "what is NOT included in this scope",
  "disclaimer": "standard biohazard remediation disclaimer",
  "completed_by": ""
}`,

    assessment_document: `Return ONLY valid JSON:
{
  "title": "Assessment document — [client name]",
  "reference": "${r}",
  "site_summary": "concise site context and purpose of visit",
  "hazards_overview": "identified hazards and contamination characterisation",
  "risks_overview": "risk narrative for workers, occupants, and third parties",
  "control_measures": "proposed or observed controls, containment, PPE",
  "recommendations": "recommended next steps or remediation scope",
  "limitations": "limits of assessment, assumptions, or areas not inspected",
  "completed_by": ""
}
If ASSESSMENT DOCUMENT — STAFF CAPTURE appears in JOB CONTEXT with labelled lines, align these fields with that staff capture and do not contradict it.`,

    swms: `Return ONLY valid JSON:
{
  "title": "Safe Work Method Statement — [job type] at [address]",
  "reference": "${r}",
  "project_details": "Site: ${job.site_address} | Client: ${job.client_name} | Date: ${d} | Contractor: ${company?.name ?? 'Brisbane Biohazard Cleaning'}",
  "steps": [
    {"step":"task name","hazards":"identified hazards","risk_before":"H/M/L","controls":"control measures","risk_after":"H/M/L","responsible":"Technician"}
  ],
  "ppe_required": "full paragraph listing all PPE and when it must be worn",
  "emergency_procedures": "site emergency contacts, nearest hospital, spill procedures, evacuation",
  "legislation_references": "WHS Act 2011, relevant codes of practice, AS/NZS standards",
  "declarations": "All workers must read and acknowledge this SWMS before commencing work. This document is to be kept on site for the duration of works.",
  "completed_by": ""
}
Include 6–10 realistic steps covering: site assessment, PPE donning, containment setup, biohazard removal, surface treatment, disposal, decontamination, final inspection.`,

    authority_to_proceed: `Return ONLY valid JSON:
{
  "title": "Authority to Proceed",
  "reference": "${r}",
  "scope_summary": "clear plain-language summary of the work authorised",
  "access_details": "how and when the contractor may access the property",
  "special_conditions": "any conditions or requirements specific to this job",
  "liability_acknowledgment": "client acknowledges risks, confirms authorisation to remove and dispose of biohazardous material",
  "payment_authorisation": "client authorises payment of the quoted amount per the agreed terms",
  "completed_by": ""
}`,

    engagement_agreement: `Return ONLY valid JSON:
{
  "title": "Engagement Agreement — Biohazard Remediation Services",
  "reference": "${r}",
  "parties": "This agreement is between ${company?.name ?? 'Brisbane Biohazard Cleaning'} (ABN: ${company?.abn ?? ''}) ('the Contractor') and ${job.client_name} ('the Client') in respect of works at ${job.site_address}.",
  "services_description": "detailed description of services to be provided",
  "fees_and_payment": "fee structure, deposit, payment schedule, late payment terms",
  "liability_limitations": "limitation of liability clause, exclusions, consequential loss",
  "confidentiality": "both parties agree to maintain confidentiality regarding the nature of works",
  "dispute_resolution": "escalation process, mediation before legal action, jurisdiction",
  "termination": "conditions under which either party may terminate, notice periods, cancellation fees",
  "governing_law": "This agreement is governed by the laws of Queensland, Australia.",
  "completed_by": ""
}`,

    report: `Return ONLY valid JSON:
{
  "title": "Completion Report — [client name]",
  "reference": "${r}",
  "executive_summary": "brief overview of what was done and outcome",
  "site_conditions": "conditions found on arrival",
  "works_carried_out": "detailed narrative of all work performed",
  "methodology": "methods and techniques used",
  "products_used": "all chemicals, products, equipment used with concentrations where relevant",
  "waste_disposal": "volumes removed, packaging, disposal facility, manifest reference if applicable",
  "photo_record": "brief description of photo documentation taken",
  "outcome": "final statement that site is remediated and safe",
  "technician_signoff": "Remediation completed in accordance with industry standards. Site returned to safe condition.",
  "completed_by": ""
}`,

    certificate_of_decontamination: `Return ONLY valid JSON:
{
  "title": "Certificate of Decontamination",
  "reference": "${r}",
  "date_of_works": "${d}",
  "works_summary": "concise summary of decontamination works performed",
  "decontamination_standard": "standard or protocol followed (e.g. AS/NZS, EPA guidelines)",
  "products_used": "antimicrobial/disinfection products used with active ingredients",
  "outcome_statement": "This certifies that the premises at [address] have been professionally decontaminated and are suitable for re-occupation.",
  "limitations": "This certificate relates only to the areas treated. Ongoing monitoring recommended for [any specific concern].",
  "certifier_statement": "Issued by ${company?.name ?? 'Brisbane Biohazard Cleaning'} | Licence: ${company?.licence ?? ''} | ${d}",
  "completed_by": ""
}`,

    waste_disposal_manifest: `Return ONLY valid JSON:
{
  "title": "Waste Disposal Manifest",
  "reference": "${r}",
  "collection_date": "${d}",
  "waste_items": [
    {"description":"waste type","quantity":"0","unit":"kg/L/bags","disposal_method":"method","facility":"facility name"}
  ],
  "transport_details": "vehicle registration, transport company, driver name, route, containment method",
  "declaration": "I declare that the waste described in this manifest was collected, transported and disposed of in accordance with the Environmental Protection Act 1994 (Qld) and relevant waste management legislation.",
  "completed_by": ""
}
Include realistic waste items based on the job type and assessment data.`,

    jsa: `Return ONLY valid JSON:
{
  "title": "Job Safety Analysis — [job type] at [address]",
  "reference": "${r}",
  "job_description": "brief description of the job and location",
  "steps": [
    {"step":"task name","hazards":"hazards","risk_before":"H/M/L","controls":"controls","risk_after":"H/M/L","responsible":"Technician"}
  ],
  "ppe_required": "list and description of all PPE required",
  "emergency_contacts": "site supervisor, emergency services, poison information centre 13 11 26, nearest hospital",
  "sign_off": "All personnel must read and acknowledge this JSA before commencing work.",
  "completed_by": ""
}
Include 5–8 steps covering the key tasks for this specific job type.`,

    nda: `Return ONLY valid JSON:
{
  "title": "Non-Disclosure Agreement",
  "reference": "${r}",
  "parties": "This Agreement is between ${company?.name ?? 'Brisbane Biohazard Cleaning'} ('Contractor') and ${job.client_name} ('Disclosing Party') regarding works at ${job.site_address}.",
  "confidential_information_definition": "All information relating to the nature, circumstances, location and details of the remediation works, including but not limited to the type of biohazard, identities of any individuals involved, and photographic evidence.",
  "obligations": "The Contractor agrees to hold all Confidential Information in strict confidence and not disclose to any third party without prior written consent, except as required by law.",
  "exceptions": "Disclosure may be required by law enforcement, coronial inquiry, or public health authorities. Contractor will notify Client of any compelled disclosure where legally permitted.",
  "term": "These confidentiality obligations survive the completion of works and continue indefinitely.",
  "remedies": "Breach of this agreement may cause irreparable harm. The Disclosing Party is entitled to seek injunctive relief in addition to any other remedies at law.",
  "governing_law": "This agreement is governed by the laws of Queensland, Australia.",
  "completed_by": ""
}`,

    risk_assessment: `Return ONLY valid JSON:
{
  "title": "Risk Assessment — [job type] at [address]",
  "reference": "${r}",
  "site_description": "description of site and nature of works",
  "assessment_date": "${d}",
  "assessor": "${company?.name ?? 'Brisbane Biohazard Cleaning'}",
  "risks": [
    {"hazard":"hazard name","likelihood":"H/M/L","consequence":"H/M/L","risk_rating":"H/M/L","controls":"control measures","residual_risk":"H/M/L"}
  ],
  "overall_risk_rating": "H/M/L — with controls in place",
  "recommendations": "any additional recommendations or precautions",
  "review_date": "Review before commencement of works and if site conditions change.",
  "completed_by": ""
}
Include 6–10 realistic risks based on the job type, contamination level, and special risks identified.`,
    iaq_multi:
      '(Not used — bundle is composed deterministically from job data. Claude build is disabled for this type.)',
  }

  const rules = getDocumentRulesForBuild(type, company, platformDbRules)

  return `You are a professional document writer for ${company?.name ?? 'Brisbane Biohazard Cleaning'}, an Australian biohazard remediation company.
${rules}
JOB CONTEXT:
${ctx}

${documentDriverInstructions(type, job.assessment_data)}

Generate a professional ${type.replace(/_/g,' ').toUpperCase()} document.

${schemas[type]}

Be specific — reference the actual site, job type, and assessment data. Do not be generic. Return ONLY the JSON object, no other text.`
}

/* Fetches a PDF from a public URL and returns it as a base64 string
   for inclusion as a Claude document block (style guide reference). */
async function fetchPdfBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    return Buffer.from(buf).toString('base64')
  } catch {
    return null
  }
}

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

    const { type, job, photos, company } = await req.json() as {
      type: DocType
      job: Job
      photos: Photo[]
      company: CompanyProfile | null
    }

    if (!type || !job) {
      return NextResponse.json({ error: 'type and job are required' }, { status: 400 })
    }

    if (job.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (type === 'iaq_multi') {
      return NextResponse.json(
        {
          error:
            'This bundle is built from job data only. Open it from Job Home → Generate documents, then edit in the form.',
        },
        { status: 400 },
      )
    }

    const gateError = validateBuildDocument(type, job)
    if (gateError) {
      return NextResponse.json({ error: gateError }, { status: 400 })
    }

    const platformDbRules = await fetchPlatformDocumentRules()
    const prompt = buildPrompt(type, job, photos ?? [], company, platformDbRules)

    // Optionally prepend a style guide PDF as a Claude document block.
    // document_rules[type + '_pdf'] stores the public URL of an example
    // document that Claude should use as a formatting/style reference.
    type ContentBlock =
      | { type: 'text'; text: string }
      | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string }; title?: string; context?: string }

    const userContent: ContentBlock[] = []

    const platformPdfUrl = platformDbRules[type + '_pdf']
    if (platformPdfUrl) {
      const pdfBase64 = await fetchPdfBase64(platformPdfUrl)
      if (pdfBase64) {
        userContent.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          title: `Platform ${type} style guide`,
          context: `Platform-wide example ${type} for all organisations. Match its formatting, structure, tone and level of detail. If a second example PDF is attached after this one, that is the organisation's own style guide — prefer the organisation example where they conflict.`,
        })
      }
    }

    const orgStylePdfUrl = company?.document_rules?.[type + '_pdf']
    if (orgStylePdfUrl) {
      const pdfBase64 = await fetchPdfBase64(orgStylePdfUrl)
      if (pdfBase64) {
        userContent.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          title: `${type} organisation style guide`,
          context: `This organisation's example ${type} document. Match it when it disagrees with the platform example above.`,
        })
      }
    }

    userContent.push({ type: 'text', text: prompt })

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: userContent }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON returned from Claude')

    const content = JSON.parse(jsonMatch[0])
    return NextResponse.json({ content })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
