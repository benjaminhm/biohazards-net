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
  DocType,
  Job,
  Photo,
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

export type ComposeSource = 'staff_sow' | 'assessment_facts' | 'skeleton' | 'assessment_capture'

export interface ComposeDocumentResult {
  content: Record<string, unknown>
  source: ComposeSource
}

/** Optional data for composing the completion report from execute-phase sources (photos, notes, PER silos). */
export interface ComposeDocumentOptions {
  report?: Partial<Pick<CompletionReportComposeContext, 'photos' | 'progressNotes' | 'progressRoomNotes'>>
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

function composeAssessmentDocument(job: Job): ComposeDocumentResult {
  const m = mergedAssessmentDocumentCapture(job.assessment_data)
  const c: AssessmentDocumentContent = {
    title: 'Assessment document',
    reference: refPrefix('assessment_document', job.id),
    site_summary: m.site_summary.trim(),
    hazards_overview: m.hazards_overview.trim(),
    risks_overview: m.risks_overview.trim(),
    control_measures: m.control_measures.trim(),
    recommendations: m.recommendations.trim(),
    limitations: m.limitations.trim(),
    completed_by: '',
  }
  if (assessmentDocumentHasContent(job.assessment_data)) {
    return { content: { ...c }, source: 'assessment_capture' }
  }
  return { content: { ...c }, source: 'skeleton' }
}

function composeSow(job: Job): ComposeDocumentResult {
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
    const c: SOWContent = {
      title: 'Scope of Work',
      reference: refPrefix('sow', job.id),
      executive_summary: exec || `Site: ${job.site_address}. Job type: ${String(job.job_type).replace(/_/g, ' ')}.`,
      scope: areaLines || '— Areas to be confirmed in assessment.',
      methodology: '— To be confirmed.',
      safety_protocols: '— To be confirmed from assessment PPE and hazards.',
      waste_disposal: ad.estimated_waste_litres
        ? `Estimated waste volume: ${ad.estimated_waste_litres} L (indicative).`
        : '— To be confirmed.',
      timeline: ad.estimated_hours ? `Estimated duration: ${ad.estimated_hours} hours (indicative).` : '— To be confirmed.',
      exclusions: '— To be listed.',
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

function composeSwms(job: Job): ComposeDocumentResult {
  const c: SWMSContent = {
    title: `Safe Work Method Statement — ${String(job.job_type).replace(/_/g, ' ')} at ${job.site_address}`,
    reference: refPrefix('swms', job.id),
    project_details: `Site: ${job.site_address} | Client: ${job.client_name}`,
    steps: [],
    ppe_required: '— To be completed.',
    emergency_procedures: '— To be completed.',
    legislation_references: 'WHS Act 2011 (Qld); relevant codes of practice.',
    declarations: 'All workers must read and acknowledge this SWMS before commencing work.',
    completed_by: '',
  }
  return { content: { ...c }, source: 'skeleton' }
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
    include_photos: true,
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

function composeJsa(job: Job): ComposeDocumentResult {
  const c: JSAContent = {
    title: `Job Safety Analysis — ${job.site_address}`,
    reference: refPrefix('jsa', job.id),
    job_description: '—',
    steps: [],
    ppe_required: '—',
    emergency_contacts: '—',
    sign_off: '—',
    completed_by: '',
  }
  return { content: { ...c }, source: 'skeleton' }
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

function composeRiskAssessment(job: Job): ComposeDocumentResult {
  const c: RiskAssessmentContent = {
    title: 'Risk Assessment',
    reference: refPrefix('risk_assessment', job.id),
    site_description: job.site_address,
    assessment_date: new Date().toLocaleDateString('en-AU'),
    assessor: '—',
    risks: [],
    overall_risk_rating: '—',
    recommendations: '—',
    review_date: '—',
    completed_by: '',
  }
  return { content: { ...c }, source: 'skeleton' }
}

/**
 * Build document JSON deterministically from job state (no AI API calls).
 */
function composeIaqMulti(job: Job): ComposeDocumentResult {
  const a = composeAssessmentDocument(job)
  const s = composeSow(job)
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
  switch (type) {
    case 'iaq_multi':
      return composeIaqMulti(job)
    case 'assessment_document':
      return composeAssessmentDocument(job)
    case 'sow':
      return composeSow(job)
    case 'quote':
      return composeQuote(job)
    case 'swms':
      return composeSwms(job)
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
      return composeJsa(job)
    case 'nda':
      return composeNda(job)
    case 'risk_assessment':
      return composeRiskAssessment(job)
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
