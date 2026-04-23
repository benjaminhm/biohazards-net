/*
 * lib/composeDocument.ts
 *
 * Deterministic "composer": builds document JSON from job state (staff capture,
 * assessment facts) with no external AI calls. Used when opening /docs/[type]?compose=1
 * so [+ doc] shows a formatted preview first.
 *
 * See docs/document-pipeline-hitl-pandadoc.md — compose is separate from optional AI tools on the editor.
 */
import type {
  Area,
  ChemicalCatalogueItem,
  DocType,
  EquipmentCatalogueItem,
  Job,
  Photo,
  RiskRow,
  SOWContent,
  AssessmentDocumentContent,
  QuoteContent,
  SWMSContent,
  AuthorityToProceedContent,
  EngagementAgreementContent,
  ReportContent,
  CertificateOfDecontaminationContent,
  WasteDisposalManifestContent,
  JSAContent,
  NDAContent,
  RiskAssessmentContent,
} from '@/lib/types'
import { mergedSowCapture, staffSowHasContent } from '@/lib/sowCapture'
import { mergedCompletionReportCapture, completionReportCaptureHasContent } from '@/lib/completionReportCapture'
import {
  assembleCompletionReportFromSources,
  mergeStaffCompletionWithAssembly,
  type CompletionReportComposeContext,
} from '@/lib/perCompletionAssembly'
import { assessmentDocumentHasContent, mergedAssessmentDocumentCapture } from '@/lib/assessmentDocumentCapture'
import { buildPrintHTML, type ClientInfo } from '@/lib/printDocument'
import type { CompanyProfile } from '@/lib/types'
import {
  presentingHealthHazardsFromAssessment,
  presentingRisksFromAssessment,
} from '@/lib/documentGenerationDrivers'
import {
  chemicalsPpeUnion,
  jobContentsItems,
  jobStructureItems,
  presentingRecommendationsFromAssessment,
  ppeEquipment,
  resolveJobChemicals,
  resolveJobEquipment,
  type ResolvedChemicalItem,
  type ResolvedEquipmentItem,
} from '@/lib/assessmentResolvers'

export type ComposeSource = 'staff_sow' | 'assessment_facts' | 'skeleton' | 'assessment_capture'

export interface ComposeDocumentResult {
  content: Record<string, unknown>
  source: ComposeSource
}

/** Optional data for composing the completion report from execute-phase sources (photos, notes, PER silos). */
export interface ComposeDocumentOptions {
  report?: Partial<Pick<CompletionReportComposeContext, 'photos' | 'progressNotes' | 'progressRoomNotes'>>
  /** Org equipment catalogue so we can resolve used_equipment_catalogue_ids → named rows. */
  equipmentCatalogue?: EquipmentCatalogueItem[] | null
  /** Org chemicals catalogue so we can resolve used_chemical_catalogue_uses → named rows with SDS-parsed PPE. */
  chemicalsCatalogue?: ChemicalCatalogueItem[] | null
}

const todayRef = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')

function refPrefix(type: DocType, jobId: string): string {
  const tail = jobId.replace(/-/g, '').slice(0, 4).toUpperCase()
  const map: Partial<Record<DocType, string>> = {
    iaq_multi: 'IAQ',
    sow: 'SOW',
    quote: 'QUO',
    report: 'RPT',
    swms: 'SWMS',
    authority_to_proceed: 'ATP',
    engagement_agreement: 'EA',
    certificate_of_decontamination: 'COD',
    waste_disposal_manifest: 'WDM',
    jsa: 'JSA',
    nda: 'NDA',
    risk_assessment: 'RA',
    assessment_document: 'ASD',
  }
  const p = map[type] ?? 'DOC'
  return `${p}-${todayRef()}-${tail}`
}

const SHELL_SOW_MSG =
  'This Scope of Work shell was composed from job data. Add Scope of Work capture on the job, or complete the text in Edit fields after assessment.'

function formatJobUrgency(job: Job): string {
  switch (job.urgency) {
    case 'urgent':
      return 'Urgent'
    case 'emergency':
      return 'Emergency'
    default:
      return 'Standard'
  }
}

/** Meta row for SOW print layout (address, area, priority). */
function sowMetaFromJob(job: Job): Pick<SOWContent, 'meta_site_address' | 'meta_area_label' | 'meta_priority'> {
  const ad = job.assessment_data
  const areaLabel = ad?.areas?.length
    ? ad.areas.map(a => a.name).filter(Boolean).join(', ') || '—'
    : '—'
  return {
    meta_site_address: job.site_address?.trim() || '—',
    meta_area_label: areaLabel,
    meta_priority: formatJobUrgency(job),
  }
}

/* ───────────────── HITL → text / tables helpers (shared) ─────────────────── */

/**
 * Union of PPE items from two sources, preserving "signal" from the chemical
 * SDS first (so respirator / goggles / gloves come before general workwear).
 * - Chemical SDS-parsed PPE: string list (often 5–10 items).
 * - Org equipment catalogue entries ticked on this job with category === 'ppe'.
 * - Assessment checklist ppe_required flags (boolean map) as a final fallback.
 */
function composePpeList(
  chems: ResolvedChemicalItem[],
  equipment: ResolvedEquipmentItem[],
  checklist?: Record<string, boolean>,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (s: string) => {
    const key = s.toLowerCase().trim()
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(s)
  }
  for (const p of chemicalsPpeUnion(chems)) push(p)
  for (const e of ppeEquipment(equipment)) push(e.name)
  if (checklist) {
    for (const [k, v] of Object.entries(checklist)) {
      if (!v) continue
      push(k.replace(/_/g, ' '))
    }
  }
  return out
}

function composeEmergencyProcedures(chems: ResolvedChemicalItem[]): string {
  const lines: string[] = []
  const danger = chems.filter(c => c.signal_word === 'danger')
  if (danger.length) {
    lines.push(
      `Elevated risk: ${danger.map(c => c.name).join(', ')} (SDS signal word "DANGER" — consult SDS on site).`,
    )
  }
  const firstAid = chems.filter(c => c.first_aid_summary)
  if (firstAid.length) {
    lines.push('First-aid (per SDS):')
    for (const c of firstAid) lines.push(`  - ${c.name}: ${c.first_aid_summary}`)
  }
  lines.push(
    'In an emergency: stop work, isolate the area, summon first-aid / 000, and notify the supervisor. Retain this SWMS and the relevant SDS with the incident report.',
  )
  return lines.join('\n')
}

/**
 * Seed WorkStep[] for SWMS/JSA from HITL signal. Each presenting risk becomes
 * a row; the "controls" field is populated from any presenting recommendation
 * whose label overlaps the risk, plus the chemical / equipment that is relevant
 * to the risk category. Downstream AI (build-document) can refine, but the
 * deterministic preview is already structurally complete.
 */
function composeWorkSteps(
  job: Job,
  recsText: string,
  equipment: ResolvedEquipmentItem[],
  chems: ResolvedChemicalItem[],
): Array<{
  step: string
  hazards: string
  risk_before: string
  controls: string
  risk_after: string
  responsible: string
}> {
  const risks = presentingRisksFromAssessment(job.assessment_data)
  if (!risks.length) return []
  const equipmentText = equipment.length
    ? equipment.map(e => e.name).slice(0, 6).join(', ')
    : ''
  const chemicalsText = chems.length
    ? chems.map(c => `${c.name}${c.dilution ? ` (${c.dilution})` : ''}`).slice(0, 6).join(', ')
    : ''
  return risks.map(r => {
    const controlBits: string[] = []
    if (recsText) controlBits.push(recsText)
    if (equipmentText) controlBits.push(`Equipment: ${equipmentText}`)
    if (chemicalsText) controlBits.push(`Chemicals: ${chemicalsText}`)
    controlBits.push('Follow SWMS stop-work triggers and supervisor sign-off gates.')
    return {
      step: r.label,
      hazards: `[${r.category}] ${r.label}`,
      risk_before: 'H',
      controls: controlBits.join(' · '),
      risk_after: 'L',
      responsible: 'Lead technician',
    }
  })
}

function composeRiskAssessmentRows(
  job: Job,
  equipment: ResolvedEquipmentItem[],
  chems: ResolvedChemicalItem[],
): RiskRow[] {
  const risks = presentingRisksFromAssessment(job.assessment_data)
  if (!risks.length) return []
  const recs = presentingRecommendationsFromAssessment(job.assessment_data)
  const equipmentText = equipment.length ? equipment.map(e => e.name).slice(0, 4).join(', ') : ''
  const chemicalsText = chems.length
    ? chems.map(c => `${c.name}${c.dilution ? ` @ ${c.dilution}` : ''}`).slice(0, 4).join(', ')
    : ''
  return risks.map(r => {
    const controls: string[] = []
    for (const rec of recs) {
      if (rec.label.toLowerCase().includes(r.label.toLowerCase().split(' ')[0] ?? '')) {
        controls.push(rec.label)
      }
    }
    if (!controls.length && recs.length) controls.push(recs[0].label)
    if (equipmentText) controls.push(`Equipment: ${equipmentText}`)
    if (chemicalsText) controls.push(`Chemicals: ${chemicalsText}`)
    return {
      hazard: `[${r.category}] ${r.label}`,
      likelihood: 'M',
      consequence: 'H',
      risk_rating: 'H',
      controls: controls.length ? controls.join(' · ') : 'To be completed.',
      residual_risk: 'L',
    }
  })
}

/** Bullet list of presenting recommendations (label first, rationale after em dash). */
function composeRecommendationsProse(job: Job): string {
  const recs = presentingRecommendationsFromAssessment(job.assessment_data)
  if (!recs.length) return ''
  return recs
    .map(r => `- ${r.label}${r.rationale ? ` — ${r.rationale}` : ''}`)
    .join('\n')
}

/** Summary line for methodology: "chem X at 1:10 by surface wipe". */
function composeMethodologyFromResolved(
  equipment: ResolvedEquipmentItem[],
  chems: ResolvedChemicalItem[],
): string {
  const lines: string[] = []
  if (equipment.length) {
    const items = equipment
      .filter(e => e.category !== 'ppe')
      .map(e => (e.notes ? `${e.name} (${e.notes})` : e.name))
    if (items.length) lines.push(`Equipment: ${items.join('; ')}.`)
  }
  if (chems.length) {
    const items = chems.map(c => {
      const det: string[] = [c.application]
      if (c.dilution) det.push(c.dilution)
      return `${c.name} — ${det.join(', ')}`
    })
    lines.push(`Chemistry: ${items.join('; ')}.`)
  }
  return lines.join('\n')
}

function composeSafetyFromResolved(
  chems: ResolvedChemicalItem[],
  equipment: ResolvedEquipmentItem[],
  checklist?: Record<string, boolean>,
): string {
  const ppe = composePpeList(chems, equipment, checklist)
  const lines: string[] = []
  if (ppe.length) lines.push(`PPE: ${ppe.join(', ')}.`)
  const handling = chems.filter(c => c.handling_precautions)
  if (handling.length) {
    lines.push('Chemical handling (per SDS):')
    for (const c of handling) lines.push(`  - ${c.name}: ${c.handling_precautions}`)
  }
  return lines.join('\n')
}

/* ───────────────── Composers ─────────────────────────────────────────────── */

function composeAssessmentDocument(
  job: Job,
  equipment: ResolvedEquipmentItem[],
  chems: ResolvedChemicalItem[],
): ComposeDocumentResult {
  const m = mergedAssessmentDocumentCapture(job.assessment_data)
  const ad = job.assessment_data
  const hasStaff = assessmentDocumentHasContent(ad)

  // When staff capture is absent or sparse, seed each narrative slot from HITL.
  const hazards = presentingHealthHazardsFromAssessment(ad)
  const risks = presentingRisksFromAssessment(ad)
  const recs = presentingRecommendationsFromAssessment(ad)
  const contents = jobContentsItems(ad)
  const structure = jobStructureItems(ad)

  const hazardsSeed = hazards.length
    ? hazards.map(h => `- [${h.category}] ${h.label}`).join('\n')
    : ''
  const risksSeed = risks.length
    ? risks.map(r => `- [${r.category}] ${r.label}`).join('\n')
    : ''
  const controlSeedBits: string[] = []
  if (equipment.length) {
    controlSeedBits.push(
      `Equipment deployed: ${equipment.map(e => e.name).join(', ')}.`,
    )
  }
  if (chems.length) {
    controlSeedBits.push(
      `Chemicals in use: ${chems
        .map(c => `${c.name}${c.dilution ? ` @ ${c.dilution}` : ''} (${c.application})`)
        .join('; ')}.`,
    )
  }
  if (recs.length) {
    controlSeedBits.push(`Controls aligned to presenting recommendations.`)
  }
  const controlsSeed = controlSeedBits.join('\n')
  const recsSeed = recs.length
    ? recs.map(r => `- [${r.audience}] ${r.label}${r.rationale ? ` — ${r.rationale}` : ''}`).join('\n')
    : ''
  const limitationsBits: string[] = []
  const undetermined = contents.filter(i => i.disposition === 'undetermined')
  if (undetermined.length) {
    limitationsBits.push(
      `Contents awaiting disposition decision: ${undetermined.length} item${undetermined.length === 1 ? '' : 's'}.`,
    )
  }
  const monitoredStructure = structure.filter(s => s.action === 'monitor')
  if (monitoredStructure.length) {
    limitationsBits.push(
      `Structural elements flagged for monitoring pending re-inspection: ${monitoredStructure
        .map(s => `${s.room} ${s.element}`)
        .join(', ')}.`,
    )
  }
  if (ad?.access_restrictions) limitationsBits.push(`Access restrictions: ${ad.access_restrictions}.`)
  const limitationsSeed = limitationsBits.join('\n')

  const c: AssessmentDocumentContent = {
    title: 'Assessment document',
    reference: refPrefix('assessment_document', job.id),
    site_summary: m.site_summary.trim() || (job.site_address ? `Site: ${job.site_address}.` : ''),
    hazards_overview: m.hazards_overview.trim() || hazardsSeed,
    risks_overview: m.risks_overview.trim() || risksSeed,
    control_measures: m.control_measures.trim() || controlsSeed,
    recommendations: m.recommendations.trim() || recsSeed,
    limitations: m.limitations.trim() || limitationsSeed,
    completed_by: '',
  }
  if (hasStaff) return { content: { ...c }, source: 'assessment_capture' }
  // If we were able to seed from HITL, this is better than a blank skeleton.
  const seededSomething =
    Boolean(hazardsSeed || risksSeed || controlsSeed || recsSeed || limitationsSeed)
  return { content: { ...c }, source: seededSomething ? 'assessment_facts' : 'skeleton' }
}

function composeSow(
  job: Job,
  equipment: ResolvedEquipmentItem[],
  chems: ResolvedChemicalItem[],
): ComposeDocumentResult {
  const ad = job.assessment_data
  const sow = mergedSowCapture(ad)

  if (staffSowHasContent(ad)) {
    const c: SOWContent = {
      title: 'Scope of Work',
      reference: refPrefix('sow', job.id),
      executive_summary: sow.objective.trim(),
      scope: sow.scope_work.trim(),
      methodology: sow.methodology.trim(),
      safety_protocols: sow.safety.trim(),
      waste_disposal: sow.waste.trim(),
      timeline: sow.timeline.trim(),
      exclusions: sow.exclusions.trim(),
      disclaimer: sow.caveats.trim(),
      completed_by: '',
      include_photos: true,
      ...sowMetaFromJob(job),
    }
    return { content: { ...c }, source: 'staff_sow' }
  }

  if (ad) {
    const areaLines = ad.areas?.length
      ? ad.areas.map(a => `${a.name}: ${a.sqm} sqm — ${a.description || '—'}`.trim()).join('\n')
      : ''
    const exec = [ad.observations?.trim(), ad.access_restrictions?.trim()]
      .filter(Boolean)
      .join('\n\n')
    const methodology = composeMethodologyFromResolved(equipment, chems) || '— To be confirmed.'
    const safety = composeSafetyFromResolved(
      chems,
      equipment,
      ad.ppe_required as Record<string, boolean> | undefined,
    ) || '— To be confirmed from assessment PPE and hazards.'
    const recsText = composeRecommendationsProse(job)
    const c: SOWContent = {
      title: 'Scope of Work',
      reference: refPrefix('sow', job.id),
      executive_summary: exec || `Site: ${job.site_address}. Job type: ${String(job.job_type).replace(/_/g, ' ')}.`,
      scope: areaLines || '— Areas to be confirmed in assessment.',
      methodology,
      safety_protocols: safety,
      waste_disposal: ad.estimated_waste_litres
        ? `Estimated waste volume: ${ad.estimated_waste_litres} L (indicative).`
        : '— To be confirmed.',
      timeline: ad.estimated_hours ? `Estimated duration: ${ad.estimated_hours} hours (indicative).` : '— To be confirmed.',
      exclusions: recsText ? `Recommendations flagged during assessment:\n${recsText}` : '— To be listed.',
      disclaimer: SHELL_SOW_MSG,
      completed_by: '',
      include_photos: true,
      ...sowMetaFromJob(job),
    }
    return { content: { ...c }, source: 'assessment_facts' }
  }

  const c: SOWContent = {
    title: 'Scope of Work',
    reference: refPrefix('sow', job.id),
    executive_summary: SHELL_SOW_MSG,
    scope: '',
    methodology: '',
    safety_protocols: '',
    waste_disposal: '',
    timeline: '',
    exclusions: '',
    disclaimer: '',
    completed_by: '',
    include_photos: true,
    ...sowMetaFromJob(job),
  }
  return { content: { ...c }, source: 'skeleton' }
}

function composeQuote(job: Job): ComposeDocumentResult {
  const ad = job.assessment_data
  const cap = ad?.outcome_quote_capture
  const auth = cap?.authorisation
  const hasCapture = cap && cap.rows?.length > 0
  const c: QuoteContent = {
    title: 'Quote',
    reference: refPrefix('quote', job.id),
    intro: hasCapture
      ? ''
      : '— Add line items and pricing in Quote capture, or complete the quote in Edit fields after assessment.',
    line_items: [],
    outcome_rows: hasCapture ? cap.rows : undefined,
    outcome_mode: hasCapture ? 'outcomes' : undefined,
    subtotal: cap?.totals?.subtotal ?? 0,
    gst: cap?.totals?.gst ?? 0,
    total: cap?.totals?.total ?? 0,
    notes: cap?.notes ?? '',
    payment_terms: ad?.payment_terms ?? '',
    validity: cap?.validity || '30 days from date of issue',
    include_photos: true,
    completed_by: '',
    authorisation: auth ? {
      access_details: auth.access_details,
      special_conditions: auth.special_conditions,
      liability_statement: auth.liability_statement,
      acceptance_statement: auth.acceptance_statement,
    } : undefined,
  }
  return { content: { ...c }, source: hasCapture ? 'assessment_capture' : 'skeleton' }
}

function composeSwms(
  job: Job,
  equipment: ResolvedEquipmentItem[],
  chems: ResolvedChemicalItem[],
): ComposeDocumentResult {
  const ad = job.assessment_data
  const ppeList = composePpeList(chems, equipment, ad?.ppe_required as Record<string, boolean> | undefined)
  const recsText = composeRecommendationsProse(job)
  const steps = composeWorkSteps(job, recsText, equipment, chems)
  const emergency = composeEmergencyProcedures(chems)
  const c: SWMSContent = {
    title: `Safe Work Method Statement — ${String(job.job_type).replace(/_/g, ' ')} at ${job.site_address}`,
    reference: refPrefix('swms', job.id),
    project_details: `Site: ${job.site_address} | Client: ${job.client_name}`,
    steps,
    ppe_required: ppeList.length ? ppeList.join(', ') : '— To be completed.',
    emergency_procedures: emergency,
    legislation_references: 'WHS Act 2011 (Qld); relevant codes of practice.',
    declarations: 'All workers must read and acknowledge this SWMS before commencing work.',
    completed_by: '',
  }
  const seeded = steps.length > 0 || ppeList.length > 0
  return { content: { ...c }, source: seeded ? 'assessment_facts' : 'skeleton' }
}

function composeAtp(job: Job): ComposeDocumentResult {
  const auth = job.assessment_data?.outcome_quote_capture?.authorisation
  const c: AuthorityToProceedContent = {
    title: 'Authority to Proceed',
    reference: refPrefix('authority_to_proceed', job.id),
    scope_summary: '— To be completed.',
    access_details: auth?.access_details || job.assessment_data?.access_restrictions || '—',
    special_conditions: auth?.special_conditions || '—',
    liability_acknowledgment: auth?.liability_statement || '—',
    payment_authorisation: '—',
    completed_by: '',
  }
  return { content: { ...c }, source: auth ? 'assessment_capture' : 'skeleton' }
}

function composeEngagement(job: Job): ComposeDocumentResult {
  const c: EngagementAgreementContent = {
    title: 'Engagement Agreement',
    reference: refPrefix('engagement_agreement', job.id),
    parties: `${job.client_name} (Client) and the Contractor.`,
    services_description: '— To be completed.',
    fees_and_payment: '—',
    liability_limitations: '—',
    confidentiality: '—',
    dispute_resolution: '—',
    termination: '—',
    governing_law: 'Queensland, Australia',
    completed_by: '',
  }
  return { content: { ...c }, source: 'skeleton' }
}

function fieldOrDash(s: string | undefined): string {
  const t = (s ?? '').trim()
  return t || '—'
}

function composeReport(job: Job, opts?: ComposeDocumentOptions['report']): ComposeDocumentResult {
  const ctx: CompletionReportComposeContext = {
    photos: opts?.photos ?? [],
    progressNotes: opts?.progressNotes ?? [],
    progressRoomNotes: opts?.progressRoomNotes ?? [],
  }
  const staff = mergedCompletionReportCapture(job.assessment_data)
  const assembled = assembleCompletionReportFromSources(job, ctx)
  const m = mergeStaffCompletionWithAssembly(staff, assembled)

  const execLine = (m.executive_summary ?? '').trim()
    ? fieldOrDash(m.executive_summary)
    : '— To be completed after works.'

  const c: ReportContent = {
    title: 'Completion Report',
    reference: refPrefix('report', job.id),
    executive_summary: execLine,
    site_conditions: fieldOrDash(m.site_conditions),
    works_carried_out: fieldOrDash(m.works_carried_out),
    methodology: fieldOrDash(m.methodology),
    products_used: fieldOrDash(m.products_used),
    waste_disposal: fieldOrDash(m.waste_disposal),
    photo_record: fieldOrDash(m.photo_record),
    outcome: fieldOrDash(m.outcome),
    technician_signoff: fieldOrDash(m.technician_signoff),
    include_photos: false,
    completed_by: (m.technician_signoff ?? '').trim(),
  }
  let source: ComposeSource = 'skeleton'
  if (completionReportCaptureHasContent(staff)) source = 'assessment_capture'
  else if (completionReportCaptureHasContent(assembled)) source = 'assessment_facts'
  return { content: { ...c }, source }
}

function composeCod(job: Job): ComposeDocumentResult {
  const c: CertificateOfDecontaminationContent = {
    title: 'Certificate of Decontamination',
    reference: refPrefix('certificate_of_decontamination', job.id),
    date_of_works: new Date().toLocaleDateString('en-AU'),
    works_summary: '—',
    decontamination_standard: '—',
    products_used: '—',
    outcome_statement: '—',
    limitations: '—',
    certifier_statement: '—',
    completed_by: '',
  }
  return { content: { ...c }, source: 'skeleton' }
}

function composeWdm(job: Job): ComposeDocumentResult {
  const c: WasteDisposalManifestContent = {
    title: 'Waste Disposal Manifest',
    reference: refPrefix('waste_disposal_manifest', job.id),
    collection_date: new Date().toLocaleDateString('en-AU'),
    waste_items: [],
    transport_details: '—',
    declaration: '—',
    completed_by: '',
  }
  return { content: { ...c }, source: 'skeleton' }
}

function composeJsa(
  job: Job,
  equipment: ResolvedEquipmentItem[],
  chems: ResolvedChemicalItem[],
): ComposeDocumentResult {
  const ad = job.assessment_data
  const ppeList = composePpeList(chems, equipment, ad?.ppe_required as Record<string, boolean> | undefined)
  const recsText = composeRecommendationsProse(job)
  const steps = composeWorkSteps(job, recsText, equipment, chems)
  const c: JSAContent = {
    title: `Job Safety Analysis — ${job.site_address}`,
    reference: refPrefix('jsa', job.id),
    job_description: job.notes?.trim() || `${String(job.job_type).replace(/_/g, ' ')} at ${job.site_address}`,
    steps,
    ppe_required: ppeList.length ? ppeList.join(', ') : '—',
    emergency_contacts: '000 (police / ambulance / fire). Supervisor on call — to be entered before commencement.',
    sign_off: 'Each worker to sign below acknowledging they have read and understood this JSA.',
    completed_by: '',
  }
  const seeded = steps.length > 0 || ppeList.length > 0
  return { content: { ...c }, source: seeded ? 'assessment_facts' : 'skeleton' }
}

function composeNda(job: Job): ComposeDocumentResult {
  const c: NDAContent = {
    title: 'Non-Disclosure Agreement',
    reference: refPrefix('nda', job.id),
    parties: `${job.client_name} and the Contractor.`,
    confidential_information_definition: '—',
    obligations: '—',
    exceptions: '—',
    term: '—',
    remedies: '—',
    governing_law: 'Queensland, Australia',
    completed_by: '',
  }
  return { content: { ...c }, source: 'skeleton' }
}

function composeRiskAssessment(
  job: Job,
  equipment: ResolvedEquipmentItem[],
  chems: ResolvedChemicalItem[],
): ComposeDocumentResult {
  const rows = composeRiskAssessmentRows(job, equipment, chems)
  const recsText = composeRecommendationsProse(job)
  const overall = rows.length > 0 ? 'M' : '—'
  const c: RiskAssessmentContent = {
    title: 'Risk Assessment',
    reference: refPrefix('risk_assessment', job.id),
    site_description: job.site_address,
    assessment_date: new Date().toLocaleDateString('en-AU'),
    assessor: '—',
    risks: rows,
    overall_risk_rating: overall,
    recommendations: recsText || '—',
    review_date: '—',
    completed_by: '',
  }
  return { content: { ...c }, source: rows.length > 0 ? 'assessment_facts' : 'skeleton' }
}

/**
 * Build document JSON deterministically from job state (no AI API calls).
 */
function composeIaqMulti(
  job: Job,
  equipment: ResolvedEquipmentItem[],
  chems: ResolvedChemicalItem[],
): ComposeDocumentResult {
  const a = composeAssessmentDocument(job, equipment, chems)
  const s = composeSow(job, equipment, chems)
  const q = composeQuote(job)
  const ref = refPrefix('iaq_multi', job.id)
  const title = 'Assessment, Scope and Quote'
  const parts: Array<{ type: DocType; content: Record<string, unknown> }> = [
    { type: 'assessment_document', content: a.content },
    { type: 'sow', content: s.content },
    { type: 'quote', content: q.content },
  ]
  const source: ComposeSource =
    a.source !== 'skeleton' || s.source !== 'skeleton' || q.source !== 'skeleton'
      ? 'assessment_capture'
      : 'skeleton'
  return {
    content: {
      reference: ref,
      title,
      parts,
    },
    source,
  }
}

export function composeDocumentContent(type: DocType, job: Job, options?: ComposeDocumentOptions): ComposeDocumentResult {
  const equipment = resolveJobEquipment(job.assessment_data, options?.equipmentCatalogue ?? null)
  const chems = resolveJobChemicals(job.assessment_data, options?.chemicalsCatalogue ?? null)
  switch (type) {
    case 'iaq_multi':
      return composeIaqMulti(job, equipment, chems)
    case 'assessment_document':
      return composeAssessmentDocument(job, equipment, chems)
    case 'sow':
      return composeSow(job, equipment, chems)
    case 'quote':
      return composeQuote(job)
    case 'swms':
      return composeSwms(job, equipment, chems)
    case 'authority_to_proceed':
      return composeAtp(job)
    case 'engagement_agreement':
      return composeEngagement(job)
    case 'report':
      return composeReport(job, options?.report)
    case 'certificate_of_decontamination':
      return composeCod(job)
    case 'waste_disposal_manifest':
      return composeWdm(job)
    case 'jsa':
      return composeJsa(job, equipment, chems)
    case 'nda':
      return composeNda(job)
    case 'risk_assessment':
      return composeRiskAssessment(job, equipment, chems)
    case 'company_letter':
      // Company Letter is composed in CompanyLetterTab and persisted through /api/documents;
      // it intentionally doesn't use the deterministic composer pipeline.
      throw new Error('Company Letter is not composed via composeDocumentContent; use the Company Letter tab.')
  }
}

/**
 * Full print HTML for the job doc editor preview iframe (same body as /api/print, no embedded action bar).
 */
export function buildComposedPreviewHtml(
  type: DocType,
  content: Record<string, unknown>,
  photos: Photo[],
  areas: Area[],
  company: CompanyProfile | null,
  jobId: string,
  appUrl: string,
  client?: ClientInfo,
): string {
  return buildPrintHTML(type, content, photos, areas, company, jobId, appUrl, client, { screenActionBar: false })
}
