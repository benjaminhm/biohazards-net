/*
 * lib/prompts.ts
 *
 * Prompt builders for the legacy /api/generate/[type] route (quote, sow, report).
 * This is the older generation path — newer document types use /api/build-document
 * which has its own inline prompt schema (lib/build-document route).
 *
 * These functions convert structured job data into rich plain-text context that
 * Claude can use to produce specific, evidence-backed documents rather than
 * generic templates. Photo captions are treated as direct site evidence.
 */
import type { Job, Photo } from './types'
import { filterGroupedStages, groupPhotosByRoomAndStage } from './photoGroups'
import { photosForComposedReports } from '@/lib/photosForComposedReports'

/**
 * Formats job and assessment data into a text block injected into every prompt.
 * Converts underscore keys to spaces for readability in Claude's context window.
 */
function buildJobDataBlock(job: Job): string {
  const a = job.assessment_data!
  const totalSqm = a.areas.reduce((s, x) => s + x.sqm, 0)
  const totalVolume = a.areas.reduce((s, x) => {
    const l = Number(x.length_m ?? 0)
    const w = Number(x.width_m ?? 0)
    const h = Number(x.height_m ?? 0)
    return s + (l > 0 && w > 0 && h > 0 ? l * w * h : 0)
  }, 0)
  const risks = Object.entries(a.special_risks)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, ' '))
    .join(', ')
  const ppe = Object.entries(a.ppe_required)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, ' '))
    .join(', ')

  return `JOB DETAILS
Client: ${job.client_name}
Site: ${job.site_address}
Job Type: ${job.job_type.replace(/_/g, ' ')}
Urgency: ${job.urgency}

ASSESSMENT FINDINGS
Contamination Level: ${a.contamination_level}/5
Biohazard Type: ${a.biohazard_type}
Total Area: ${totalSqm}sqm across ${a.areas.length} areas${totalVolume > 0 ? ` (≈${Math.round(totalVolume * 100) / 100} m³)` : ''}

Areas:
${a.areas.map(x => {
  const l = Number(x.length_m ?? 0)
  const w = Number(x.width_m ?? 0)
  const h = Number(x.height_m ?? 0)
  const dims = l > 0 && w > 0
    ? ` (${l}×${w}${h > 0 ? `×${h}` : ''} m${l > 0 && w > 0 && h > 0 ? `, ${Math.round(l * w * h * 100) / 100} m³` : ''})`
    : ''
  return `- ${x.name}: ${x.sqm}sqm${dims}, hazard level ${x.hazard_level}/5\n  ${x.description}${x.note ? `\n  Room note: ${x.note}` : ''}`
}).join('\n')}

PPE Required: ${ppe || 'standard PPE'}
Special Risks: ${risks || 'none identified'}
Estimated Hours: ${a.estimated_hours}
Estimated Waste: ${a.estimated_waste_litres} litres
Access Notes: ${a.access_restrictions || 'none'}

Technician Observations: "${a.observations}"`
}

/**
 * Groups photos by area and formats them as a labelled evidence block.
 * Only includes photos in the specified categories (e.g. ['before', 'assessment']).
 */
function buildPhotoEvidenceBlock(photos: Photo[], categories: string[]): string {
  const relevant = photos.filter(p => categories.includes(p.category))
  if (relevant.length === 0) return ''
  const allowedStages = categories.filter((c): c is 'assessment' | 'before' | 'during' | 'after' =>
    c === 'assessment' || c === 'before' || c === 'during' || c === 'after'
  )
  const groups = filterGroupedStages(groupPhotosByRoomAndStage(relevant), allowedStages)
  const lines: string[] = [`\nPHOTO EVIDENCE (${relevant.length} photos):`]
  for (const group of groups) {
    lines.push(`\n${group.room.toUpperCase()}:`)
    if (group.note?.trim()) lines.push(`  Room note: ${group.note.trim()}`)
    for (const stage of ['assessment', 'before', 'during', 'after'] as const) {
      for (const p of group.stages[stage]) {
        const note = p.caption?.trim()
        if (note) lines.push(`  • [${stage}] ${note}`)
      }
    }
  }

  return lines.join('\n')
}

export function buildQuotePrompt(job: Job, photos: Photo[]): string {
  const a = job.assessment_data
  if (!a) return ''
  photos = photosForComposedReports(photos)

  const photoBlock = buildPhotoEvidenceBlock(photos, ['before', 'assessment'])

  return `You are writing a professional quote for a biohazard cleaning company in Australia called "Brisbane Biohazard Cleaning".

${buildJobDataBlock(job)}
${photoBlock}

Photo Summary: ${photos.length} photos total (${photos.filter(p => p.category === 'before').length} before, ${photos.filter(p => p.category === 'assessment').length} assessment)

DOCUMENT STRUCTURE — return ONLY valid JSON with no markdown, no code fences, no explanation:
{
  "title": "Quote — [job type] Remediation",
  "reference": "Q-[YYYYMMDD]-[first 4 chars of job id]",
  "intro": "2-3 sentences describing what was found and what the work involves. Reference the specific conditions from the photo notes and assessment.",
  "line_items": [
    {
      "description": "item description — be specific, reference actual areas and conditions",
      "qty": 1,
      "unit": "hrs or each or sqm",
      "rate": 150,
      "total": 150
    }
  ],
  "subtotal": 0,
  "gst": 0,
  "total": 0,
  "notes": "any important job-specific notes or conditions — reference the photo evidence where relevant",
  "payment_terms": "50% deposit required to confirm booking, balance due on completion",
  "validity": "This quote is valid for 30 days"
}

Job ID for reference: ${job.id}
Today's date: ${new Date().toISOString().slice(0, 10).replace(/-/g, '')}

${(() => {
  const tp   = a.target_price
  const note = (a.target_price_note || '').toLowerCase()
  if (!tp) {
    return `PRICING: Use realistic Australian market rates for biohazard work ($120–$250/hr depending on contamination level). Base labour on contamination level (${a.contamination_level}/5) and estimated hours (${a.estimated_hours}hrs). Ensure subtotal + GST (10%) = total.`
  }
  // Detect whether target_price_note signals ex-GST — if so, add 10% on top;
  // otherwise treat the target as inc. GST and back-calculate subtotal.
  const isExGST = note.includes('ex') || note.includes('excl') || note.includes('+ gst') || note.includes('+gst')
  let subtotal: number, gstAmt: number, total: number
  if (isExGST) {
    subtotal = tp
    gstAmt   = Math.round(tp * 0.1 * 100) / 100
    total    = Math.round((tp + gstAmt) * 100) / 100
  } else {
    // default: treat as inc. GST
    subtotal = Math.round((tp / 1.1) * 100) / 100
    gstAmt   = Math.round((tp - subtotal) * 100) / 100
    total    = tp
  }
  const gstNote = note ? ` (noted as: ${a.target_price_note})` : ' (treated as inc. GST)'
  return `PRICING: Target amount is $${tp.toLocaleString()}${gstNote}. Work line items BACKWARD from this. Set subtotal: ${subtotal}, gst: ${gstAmt}, total: ${total}. Line items must sum to exactly $${subtotal.toLocaleString()} (ex-GST). Distribute across logical line items (labour per area, PPE/consumables, waste disposal, callout fee) that genuinely reflect the scope — do not pad or invent work not relevant to this job.`
})()}

Include line items for: labour per area, PPE, waste disposal, callout fee, and any specialist requirements identified. Reference the specific areas, photo notes, and conditions found — do not be generic.
PAYMENT TERMS: Use exactly this text in the payment_terms field: "${a.payment_terms || '50% deposit required prior to works commencing. Remainder due on completion, net 7 days.'}"
Return ONLY the JSON object.`
}

export function buildSOWPrompt(job: Job, photos: Photo[]): string {
  const a = job.assessment_data
  if (!a) return ''
  photos = photosForComposedReports(photos)

  const photoBlock = buildPhotoEvidenceBlock(photos, ['before', 'assessment'])

  return `You are writing a Scope of Work for a biohazard remediation company in Australia called "Brisbane Biohazard Cleaning".

${buildJobDataBlock(job)}
${photoBlock}

DOCUMENT STRUCTURE — return ONLY valid JSON with no markdown, no code fences, no explanation:
{
  "title": "Scope of Work — [job type] Remediation",
  "reference": "SOW-[YYYYMMDD]-[first 4 chars of job id]",
  "executive_summary": "paragraph — what the situation is and what will be done. Reference the specific conditions documented in photos and assessment.",
  "scope": "detailed paragraph — exactly what work is included, referencing each specific area and the conditions found there (use the photo notes as evidence)",
  "methodology": "step by step methodology appropriate for this specific job type and contamination level",
  "safety_protocols": "PPE requirements and safety procedures for this specific job",
  "waste_disposal": "waste classification and disposal procedure referencing Australian EPA guidelines",
  "timeline": "estimated duration based on hours and areas",
  "exclusions": "what is not included in this scope",
  "disclaimer": "professional liability disclaimer appropriate for biohazard remediation work in Australia",
  "completed_by": ""
}

Job ID for reference: ${job.id}
Today's date: ${new Date().toISOString().slice(0, 10).replace(/-/g, '')}

Be specific to this job. Use the photo notes as direct evidence to describe conditions in each area. Write as an experienced biohazard remediation professional. Return ONLY the JSON object.`
}

export function buildReportPrompt(job: Job, photos: Photo[]): string {
  const a = job.assessment_data
  if (!a) return ''
  photos = photosForComposedReports(photos)

  const progressPhotos = photos.filter(p => {
    if (p.capture_phase === 'progress') return true
    if (p.capture_phase === 'assessment') return false
    return p.category === 'during' || p.category === 'after'
  })
  const afterBlock = buildPhotoEvidenceBlock(progressPhotos, ['after'])
  const duringBlock = buildPhotoEvidenceBlock(progressPhotos, ['during'])

  return `You are writing a completion report for a biohazard remediation job in Australia. This report may be submitted to an insurance company or regulatory body. Company: "Brisbane Biohazard Cleaning".

${buildJobDataBlock(job)}

Notes log from job: "${job.notes}"
${duringBlock}
${afterBlock}

DOCUMENT STRUCTURE — return ONLY valid JSON with no markdown, no code fences, no explanation:
{
  "title": "Biohazard Remediation Completion Report",
  "reference": "RPT-[YYYYMMDD]-[first 4 chars of job id]",
  "executive_summary": "brief factual summary of the job and outcome",
  "site_conditions": "conditions found on arrival — derive from assessment findings and notes log (not before/assessment photo stages)",
  "works_carried_out": "detailed account of all remediation work performed, referencing each area by name and what was done there",
  "methodology": "methodology used for this specific job type and contamination level",
  "products_used": "cleaning agents, PPE, and equipment appropriate for this biohazard type",
  "waste_disposal": "volume and disposal method — reference Australian EPA classification",
  "photo_record": "client-facing summary of progress photographic evidence. Reference useful photo notes as proof of completion, but do not include raw app metadata such as category labels, capture phase, upload timestamps, file IDs, or numbered metadata lists.",
  "outcome": "statement that remediation is complete and site has been returned to safe condition — reference the after photos as evidence",
  "technician_signoff": "This report certifies that biohazard remediation was carried out in accordance with Australian standards and best practice"
}

Job ID for reference: ${job.id}
Today's date: ${new Date().toISOString().slice(0, 10).replace(/-/g, '')}

Write factually and authoritatively. Use the photo notes as direct evidence throughout, but keep internal photo metadata out of the report. This document may be used for insurance or legal purposes. Return ONLY the JSON object.`
}
