import type { Job, Photo } from './types'

function buildJobDataBlock(job: Job): string {
  const a = job.assessment_data!
  const totalSqm = a.areas.reduce((s, x) => s + x.sqm, 0)
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
Total Area: ${totalSqm}sqm across ${a.areas.length} areas

Areas:
${a.areas.map(x => `- ${x.name}: ${x.sqm}sqm, hazard level ${x.hazard_level}/5\n  ${x.description}`).join('\n')}

PPE Required: ${ppe || 'standard PPE'}
Special Risks: ${risks || 'none identified'}
Estimated Hours: ${a.estimated_hours}
Estimated Waste: ${a.estimated_waste_litres} litres
Access Notes: ${a.access_restrictions || 'none'}

Technician Observations: "${a.observations}"`
}

function buildPhotoEvidenceBlock(photos: Photo[], categories: string[]): string {
  const relevant = photos.filter(p => categories.includes(p.category))
  if (relevant.length === 0) return ''

  const grouped: Record<string, Photo[]> = {}
  for (const p of relevant) {
    const key = p.area_ref || p.category
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(p)
  }

  const lines: string[] = [`\nPHOTO EVIDENCE (${relevant.length} photos):`]
  for (const [area, areaPhotos] of Object.entries(grouped)) {
    lines.push(`\n${area.toUpperCase()}:`)
    for (const p of areaPhotos) {
      const note = p.caption?.trim()
      if (note) lines.push(`  • [${p.category}] ${note}`)
    }
  }

  return lines.join('\n')
}

export function buildQuotePrompt(job: Job, photos: Photo[]): string {
  const a = job.assessment_data
  if (!a) return ''

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
  const tp = a.target_price
  const gst = a.gst_treatment ?? 'exclusive'
  if (!tp) {
    return `PRICING: Use realistic Australian market rates for biohazard work ($120–$250/hr depending on contamination level). Base labour on contamination level (${a.contamination_level}/5) and estimated hours (${a.estimated_hours}hrs). Ensure subtotal + GST (10%) = total.`
  }
  if (gst === 'exclusive') {
    const subtotal = tp
    const gstAmt = Math.round(tp * 0.1 * 100) / 100
    const total = Math.round((tp + gstAmt) * 100) / 100
    return `PRICING: The target quote is $${tp.toLocaleString()} EXCLUDING GST. Work the line items backward from this total. Line items must sum to exactly $${subtotal.toLocaleString()} (subtotal). Set subtotal: ${subtotal}, gst: ${gstAmt}, total: ${total}. Distribute the total across logical line items (labour per area, PPE, waste disposal, callout fee, specialist requirements) that reflect the actual scope — do not pad or invent work not relevant to this job.`
  }
  if (gst === 'inclusive') {
    const subtotal = Math.round((tp / 1.1) * 100) / 100
    const gstAmt = Math.round((tp - subtotal) * 100) / 100
    return `PRICING: The target quote is $${tp.toLocaleString()} INCLUSIVE of GST. Work the line items backward from this total. Line items must sum to exactly $${subtotal.toLocaleString()} (ex-GST subtotal). Set subtotal: ${subtotal}, gst: ${gstAmt}, total: ${tp}. Distribute across logical line items that reflect the actual scope.`
  }
  // none
  return `PRICING: The target quote is $${tp.toLocaleString()} with NO GST. Work the line items backward from this total. Line items must sum to exactly $${tp.toLocaleString()}. Set subtotal: ${tp}, gst: 0, total: ${tp}. Distribute across logical line items that reflect the actual scope.`
})()}

Include line items for: labour per area, PPE, waste disposal, callout fee, and any specialist requirements identified. Reference the specific areas, photo notes, and conditions found — do not be generic. Return ONLY the JSON object.`
}

export function buildSOWPrompt(job: Job, photos: Photo[]): string {
  const a = job.assessment_data
  if (!a) return ''

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
  "acceptance": "By signing below the client acknowledges and accepts this scope of work"
}

Job ID for reference: ${job.id}
Today's date: ${new Date().toISOString().slice(0, 10).replace(/-/g, '')}

Be specific to this job. Use the photo notes as direct evidence to describe conditions in each area. Write as an experienced biohazard remediation professional. Return ONLY the JSON object.`
}

export function buildReportPrompt(job: Job, photos: Photo[]): string {
  const a = job.assessment_data
  if (!a) return ''

  const beforeBlock = buildPhotoEvidenceBlock(photos, ['before', 'assessment'])
  const afterBlock = buildPhotoEvidenceBlock(photos, ['after'])
  const duringBlock = buildPhotoEvidenceBlock(photos, ['during'])

  return `You are writing a completion report for a biohazard remediation job in Australia. This report may be submitted to an insurance company or regulatory body. Company: "Brisbane Biohazard Cleaning".

${buildJobDataBlock(job)}

Notes log from job: "${job.notes}"
${beforeBlock}
${duringBlock}
${afterBlock}

DOCUMENT STRUCTURE — return ONLY valid JSON with no markdown, no code fences, no explanation:
{
  "title": "Biohazard Remediation Completion Report",
  "reference": "RPT-[YYYYMMDD]-[first 4 chars of job id]",
  "executive_summary": "brief factual summary of the job and outcome",
  "site_conditions": "conditions found on arrival — use the before photo notes as direct evidence, referencing specific areas and what was documented",
  "works_carried_out": "detailed account of all remediation work performed, referencing each area by name and what was done there",
  "methodology": "methodology used for this specific job type and contamination level",
  "products_used": "cleaning agents, PPE, and equipment appropriate for this biohazard type",
  "waste_disposal": "volume and disposal method — reference Australian EPA classification",
  "photo_record": "factual summary of photographic evidence — ${photos.length} photos taken across all phases. Reference specific after-photo notes as proof of completion.",
  "outcome": "statement that remediation is complete and site has been returned to safe condition — reference the after photos as evidence",
  "technician_signoff": "This report certifies that biohazard remediation was carried out in accordance with Australian standards and best practice"
}

Job ID for reference: ${job.id}
Today's date: ${new Date().toISOString().slice(0, 10).replace(/-/g, '')}

Write factually and authoritatively. Use the photo notes as direct evidence throughout. This document may be used for insurance or legal purposes. Return ONLY the JSON object.`
}
