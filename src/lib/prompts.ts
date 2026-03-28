import type { Job, Photo } from './types'

export function buildQuotePrompt(job: Job, photos: Photo[]): string {
  const a = job.assessment_data
  if (!a) return ''

  const totalSqm = a.areas.reduce((s, x) => s + x.sqm, 0)
  const risks = Object.entries(a.special_risks)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, ' '))
    .join(', ')
  const ppe = Object.entries(a.ppe_required)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, ' '))
    .join(', ')

  return `You are writing a professional quote for a biohazard cleaning company in Australia called "Brisbane Biohazard Cleaning".

JOB DETAILS
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

Technician Observations: "${a.observations}"

Photo Record: ${photos.length} photos (${photos.filter(p => p.category === 'before').length} before, ${photos.filter(p => p.category === 'during').length} during, ${photos.filter(p => p.category === 'after').length} after)

DOCUMENT STRUCTURE — return ONLY valid JSON with no markdown, no code fences, no explanation:
{
  "title": "Quote — [job type] Remediation",
  "reference": "Q-[YYYYMMDD]-[first 4 chars of job id]",
  "intro": "2-3 sentences describing what was found and what the work involves",
  "line_items": [
    {
      "description": "item description",
      "qty": 1,
      "unit": "hrs or each or sqm",
      "rate": 150,
      "total": 150
    }
  ],
  "subtotal": 0,
  "gst": 0,
  "total": 0,
  "notes": "any important job-specific notes or conditions",
  "payment_terms": "50% deposit required to confirm booking, balance due on completion",
  "validity": "This quote is valid for 30 days"
}

Job ID for reference: ${job.id}
Today's date: ${new Date().toISOString().slice(0, 10).replace(/-/g, '')}

Use realistic Australian market rates for biohazard work ($120–$250/hr depending on contamination level). Base labour on the contamination level (${a.contamination_level}/5) and estimated hours (${a.estimated_hours}hrs). Include line items for: labour per area, PPE, waste disposal, callout fee, and any specialist requirements. Be specific — reference the actual rooms, risks, and conditions found. Do not be generic. Ensure subtotal + GST (10%) = total. Return ONLY the JSON object.`
}

export function buildSOWPrompt(job: Job, photos: Photo[]): string {
  const a = job.assessment_data
  if (!a) return ''

  const totalSqm = a.areas.reduce((s, x) => s + x.sqm, 0)
  const risks = Object.entries(a.special_risks)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, ' '))
    .join(', ')
  const ppe = Object.entries(a.ppe_required)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, ' '))
    .join(', ')

  return `You are writing a Scope of Work for a biohazard remediation company in Australia called "Brisbane Biohazard Cleaning".

JOB DETAILS
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

Technician Observations: "${a.observations}"

Photo Record: ${photos.length} photos taken

DOCUMENT STRUCTURE — return ONLY valid JSON with no markdown, no code fences, no explanation:
{
  "title": "Scope of Work — [job type] Remediation",
  "reference": "SOW-[YYYYMMDD]-[first 4 chars of job id]",
  "executive_summary": "paragraph — what the situation is and what will be done",
  "scope": "detailed paragraph — exactly what work is included, referencing specific areas and conditions",
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

Be specific to this job. Reference the actual contamination level, areas, and risks identified. Write as an experienced biohazard remediation professional. Return ONLY the JSON object.`
}

export function buildReportPrompt(job: Job, photos: Photo[]): string {
  const a = job.assessment_data
  if (!a) return ''

  const totalSqm = a.areas.reduce((s, x) => s + x.sqm, 0)
  const risks = Object.entries(a.special_risks)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, ' '))
    .join(', ')
  const ppe = Object.entries(a.ppe_required)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, ' '))
    .join(', ')

  return `You are writing a completion report for a biohazard remediation job in Australia. This report may be submitted to an insurance company or regulatory body. Company: "Brisbane Biohazard Cleaning".

JOB DETAILS
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

Technician Observations: "${a.observations}"

Notes log from job: "${job.notes}"

DOCUMENT STRUCTURE — return ONLY valid JSON with no markdown, no code fences, no explanation:
{
  "title": "Biohazard Remediation Completion Report",
  "reference": "RPT-[YYYYMMDD]-[first 4 chars of job id]",
  "executive_summary": "brief summary of the job and outcome",
  "site_conditions": "conditions found on arrival based on assessment data — specific and factual",
  "works_carried_out": "detailed account of all remediation work performed, referencing each area",
  "methodology": "methodology used for this specific job type and contamination level",
  "products_used": "cleaning agents, PPE, and equipment appropriate for this biohazard type",
  "waste_disposal": "volume and disposal method — reference Australian EPA classification",
  "photo_record": "summary of photographic evidence — ${photos.length} photos taken across all phases",
  "outcome": "statement that remediation is complete and site has been returned to safe condition",
  "technician_signoff": "This report certifies that biohazard remediation was carried out in accordance with Australian standards and best practice"
}

Job ID for reference: ${job.id}
Today's date: ${new Date().toISOString().slice(0, 10).replace(/-/g, '')}

Write factually and authoritatively. Be specific to the actual conditions, areas, and work described. This document may be used for insurance or legal purposes. Return ONLY the JSON object.`
}
