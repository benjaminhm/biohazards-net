/*
 * lib/types.ts
 *
 * Central type definitions for the entire application.
 * Every major domain entity — Jobs, Documents, Assessments, Orgs, Permissions —
 * lives here. Import from this file rather than defining local types.
 *
 * Key architecture decisions:
 * - org_id is the multi-tenancy partition key on every table.
 * - TeamCapabilities drives all UI gating; never check role === 'admin' in
 *   components — check the relevant capability instead.
 * - ALL_CAPABILITIES is assigned to admins; members receive
 *   DEFAULT_MEMBER_CAPABILITIES merged with their custom capabilities from DB.
 * - AssessmentData is stored as a JSON column on the jobs table.
 */

export type JobStatus =
  | 'lead'
  | 'assessed'
  | 'quoted'
  | 'accepted'
  | 'scheduled'
  | 'underway'
  | 'completed'
  | 'report_sent'
  | 'paid'

export type JobUrgency = 'standard' | 'urgent' | 'emergency'

export type JobType =
  | 'crime_scene'
  | 'hoarding'
  | 'mold'
  | 'sewage'
  | 'trauma'
  | 'unattended_death'
  | 'flood'
  | 'other'

export type PhotoCategory = 'before' | 'during' | 'after' | 'assessment'
export type PhotoCapturePhase = 'assessment' | 'progress'

export type DocType =
  | 'iaq_multi'
  | 'quote'
  | 'sow'
  | 'assessment_document'
  | 'swms'
  | 'authority_to_proceed'
  | 'engagement_agreement'
  | 'report'
  | 'certificate_of_decontamination'
  | 'waste_disposal_manifest'
  | 'jsa'
  | 'nda'
  | 'risk_assessment'

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  iaq_multi:                  'Assessment / Scope / Quote',
  quote:                      'Quote',
  sow:                        'Scope of Work',
  assessment_document:        'Assessment',
  swms:                       'SWMS',
  authority_to_proceed:       'Authority to Proceed',
  engagement_agreement:       'Engagement Agreement',
  report:                     'Completion Report',
  certificate_of_decontamination: 'Certificate of Decontamination',
  waste_disposal_manifest:    'Waste Disposal Manifest',
  jsa:                        'Job Safety Analysis',
  nda:                        'Non-Disclosure Agreement',
  risk_assessment:            'Risk Assessment',
}

/** IAQPER workflow phases — Job Home document groups (not the same as DocType). */
export type DocWorkflowPhaseId =
  | 'initial_contact'
  | 'assess'
  | 'quote'
  | 'prepare'
  | 'execute'
  | 'reflect'

export interface DocTypeGroup {
  id: DocWorkflowPhaseId
  label: string
  types: DocType[]
}

export const DOC_TYPE_GROUPS: DocTypeGroup[] = [
  {
    id: 'initial_contact',
    label: '1. Initial contact',
    types: [],
  },
  {
    id: 'assess',
    label: '2. Assess',
    types: ['assessment_document', 'sow'],
  },
  {
    id: 'quote',
    label: '3. Quote',
    types: ['quote', 'engagement_agreement', 'nda'],
  },
  {
    id: 'prepare',
    label: '4. Plan',
    types: ['authority_to_proceed', 'swms', 'jsa', 'risk_assessment'],
  },
  {
    id: 'execute',
    label: '5. Execute',
    types: ['report', 'certificate_of_decontamination', 'waste_disposal_manifest'],
  },
  {
    id: 'reflect',
    label: '6. Reflect',
    types: [],
  },
]

/* A single contaminated zone within a job site */
export interface Area {
  name: string
  sqm: number
  hazard_level: number
  description: string
  note?: string
}

/* Freeform key-value pairs captured on the assessment — insurance details,
   claim numbers, access codes, etc. Rendered in documents as additional fields. */
export interface CustomField {
  label: string
  value: string
}

/** Inferred risk line from Presentation (checklists, areas, photos) — see `derivePresentationRisks`. */
export interface DerivedRiskLine {
  id: string
  group: 'checklist' | 'site' | 'areas' | 'evidence'
  label: string
  detail: string
}

/** Technician HITL: confirms whether each derived risk applies to this job */
export interface RiskHitlItem {
  id: string
  /** null = not yet reviewed; true = confirmed present; false = not applicable / not present */
  confirmed: boolean | null
  notes?: string
}

export interface RisksHitl {
  items: RiskHitlItem[]
  last_reviewed_at?: string | null
}

/** AI-extracted hazard phrases from Presentation data (Risks tab bubbles) */
export type SuggestedRiskCategory =
  | 'biological'
  | 'chemical'
  | 'physical'
  | 'environmental'
  | 'operational'

export interface SuggestedRiskAiItem {
  id: string
  label: string
  category: SuggestedRiskCategory
  /** For risk chips: approved hazard chip ids this risk was derived from (AI Identify/Generate). */
  source_hazard_ids?: string[]
}

export interface SuggestedRisksAi {
  items: SuggestedRiskAiItem[]
  generated_at: string
}

/** AI-suggested hazard themes from presenting risks (same chip shape as risks). Storage key name unchanged. */
export interface SuggestedBiohazardsAi {
  items: SuggestedRiskAiItem[]
  generated_at: string
}

export type PreflightResult = 'go' | 'go_with_conditions' | 'no_go'

export type PreflightCriticalControlId =
  | 'scope_confirmed'
  | 'swms_jsa_current_and_briefed'
  | 'isolation_containment_plan'
  | 'ppe_rpe_fit_test_met'
  | 'waste_chain_disposal_confirmed'
  | 'authority_to_proceed_documented'
  | 'emergency_escalation_contacts'

export type PreflightOperationalId =
  | 'equipment_staged_tested'
  | 'materials_consumables_available'
  | 'access_keys_induction'
  | 'utilities_ventilation_isolation_points'
  | 'site_conditions_acceptable'
  | 'stakeholder_issues_mitigated'

export interface PreflightCheckItem {
  checked: boolean
  notes?: string
  not_applicable?: boolean
}

export interface PreflightChecklistHeader {
  job_id: string
  site_address: string
  client_contact: string
  preflight_datetime: string
  supervisor_name: string
}

export interface PreflightChecklistSections {
  critical: Record<PreflightCriticalControlId, PreflightCheckItem>
  operational: Record<PreflightOperationalId, PreflightCheckItem>
}

export interface PreflightChecklistOutcome {
  result: PreflightResult | null
  critical_failure_ids: PreflightCriticalControlId[]
  conditions_notes: string
  approved_by_name: string
  approved_at: string | null
}

export interface PreRemediationPreflightChecklist {
  schema_version: 1
  header: PreflightChecklistHeader
  sections: PreflightChecklistSections
  outcome: PreflightChecklistOutcome
  updated_at: string
}

/** Staff SOW fields aligned with generated SOWContent sections. */
export interface SowCapture {
  objective: string
  scope_work: string
  methodology: string
  timeline: string
  safety: string
  waste: string
  exclusions: string
  caveats: string
}

/** Assessment → Document tab — internal staff capture (not a separate DocType). */
export interface AssessmentDocumentCapture {
  site_summary: string
  hazards_overview: string
  risks_overview: string
  control_measures: string
  recommendations: string
  limitations: string
}

export type OutcomeQuoteStatus = 'suggested' | 'approved' | 'rejected' | 'edited'

export interface OutcomeQuoteMetric {
  label: string
  value: string
}

export interface OutcomeQuoteRow {
  id: string
  areas: string[]
  outcome_title: string
  outcome_description: string
  acceptance_criteria: string
  price: number
  status: OutcomeQuoteStatus
  included: string[]
  excluded: string[]
  assumptions: string[]
  verification_method: string
  metrics?: OutcomeQuoteMetric[]
}

export interface QuoteAuthorisation {
  access_details: string
  special_conditions: string
  liability_statement: string
  acceptance_statement: string
  accepted_by?: string
  accepted_at?: string
}

export interface OutcomeQuoteCapture {
  mode: 'line_items' | 'outcomes'
  rows: OutcomeQuoteRow[]
  totals: {
    subtotal: number
    gst: number
    total: number
  }
  target_pricing: {
    target_amount?: number
    target_price_note?: string
  }
  authorisation?: QuoteAuthorisation
  last_suggested_at?: string
  last_reviewed_at?: string
}

/** Phase 1 job-scoped blocks for composer / future print wiring; stable string ids. */
export type ContentBlockType = 'prose' | 'key_value' | 'table'

export interface ContentBlock {
  id: string
  type: ContentBlockType
  title?: string
  body?: string
  pairs?: Record<string, string>
  rows?: string[][]
}

export const CONTENT_BLOCKS_VERSION = 1 as const

/*
 * AssessmentData is stored as a single JSON blob in jobs.assessment_data.
 * It is the primary input for Claude document generation — the richer the
 * data here, the better the generated quotes, reports, and SWMS.
 * target_price and target_price_note control how Claude prices quotes:
 * if set, Claude works line items backward from the target rather than
 * calculating from market rates.
 */
export interface AssessmentData {
  areas: Area[]
  contamination_level: number
  biohazard_type: string
  ppe_required: {
    gloves: boolean
    tyvek_suit: boolean
    respirator: boolean
    face_shield: boolean
    boot_covers: boolean
    double_bag: boolean
  }
  special_risks: {
    sharps: boolean
    chemicals: boolean
    structural_damage: boolean
    infectious_disease: boolean
    vermin: boolean
    mold_spores: boolean
  }
  estimated_hours: number
  estimated_waste_litres: number
  access_restrictions: string
  observations: string
  target_price?: number
  target_price_note?: string
  payment_terms?: string
  terms_and_conditions?: string
  custom_fields?: CustomField[]
  /** Confirmed derived risks (Risks sub-tab); merged with Presentation over time */
  risks_hitl?: RisksHitl
  /** Last AI pass over Presentation text/photo metadata (coloured bubbles on Risks) */
  suggested_risks_ai?: SuggestedRisksAi
  /** Strictly from Presentation text/flags only (Identify on Risks); same shape as suggested_risks_ai. */
  identified_risks_ai?: SuggestedRisksAi
  /** Technician-added risk chips; persisted across Identify/Generate. */
  manual_risk_chips?: SuggestedRiskAiItem[]
  /** Selected risk chip ids moved into "Presenting risks" on Assessment > Risks. */
  presenting_risk_ids?: string[]
  /** AI hazard chips from Generate (storage key unchanged). */
  suggested_biohazards_ai?: SuggestedBiohazardsAi
  /** Strictly from Presentation (Identify); same shape as suggested_biohazards_ai. */
  identified_biohazards_ai?: SuggestedBiohazardsAi
  /** Technician-added hazard chips; persisted across Identify/Generate. */
  manual_biohazard_chips?: SuggestedRiskAiItem[]
  /** Selected hazard chip ids in "Presenting hazards" on Assessment → Hazards. */
  presenting_biohazard_ids?: string[]
  /** Preparation phase: pre-remediation go / no-go gate (JSON payload). */
  pre_remediation_preflight?: PreRemediationPreflightChecklist
  /**
   * Scope of Work tab — staff-authored capture (feeds doc generation).
   * Legacy `sow_objective` is merged into `objective` on read via mergedSowCapture().
   */
  sow_capture?: SowCapture
  /** @deprecated Use sow_capture.objective; kept for backward compatibility with old rows. */
  sow_objective?: string
  /** Assessment → Document tab — structured narrative for internal use; feeds optional JOB CONTEXT. */
  assessment_document_capture?: AssessmentDocumentCapture
  /** Synced from assessment_document_capture on save (Phase 1). */
  content_blocks?: ContentBlock[]
  content_blocks_version?: number
  /** Execute → Completion Report capture (feeds composed report; use Data Capture, not Reflect → Generate). */
  completion_report_capture?: CompletionReportCapture
  /**
   * Execute-phase narrative silos (recommendations, QC, waste manifest notes).
   * Aggregated into the completion report when staff completion_report_capture fields are left blank.
   */
  per_execute_capture?: PerExecuteCapture
  /** Outcome-first quote capture for HITL value-based pricing; line items remain internal engine. */
  outcome_quote_capture?: OutcomeQuoteCapture
}

/* Secondary phone numbers on a job (beyond the primary client_phone).
   Stored as client_phones JSON array in the jobs table. */
export interface PhoneEntry {
  label: string   // "Mobile", "Landline", "Work", "Other"
  number: string
}

export interface Job {
  id: string
  /** Present when job payload is scoped to an org (API validation). */
  org_id?: string
  status: JobStatus
  urgency: JobUrgency
  job_type: JobType
  client_name: string
  /** Company or legal account name when the person in client_name is a representative. */
  client_organization_name?: string
  /** Title / role of the primary contact (e.g. property manager). */
  client_contact_role?: string
  /** Relationship to the site or incident (e.g. tenant, family member, insurer rep). */
  client_contact_relationship?: string
  /** Insurer claim or reference number if applicable. */
  insurance_claim_ref?: string
  client_phone: string
  client_phones: PhoneEntry[]   // additional numbers beyond primary
  client_email: string
  site_address: string
  notes: string
  assessment_data: AssessmentData | null
  scheduled_at: string | null
  schedule_note: string | null
  created_at: string
  updated_at: string
  /** Soft-archive: hidden from default job lists; data retained for reporting. */
  archived_at?: string | null
  archived_by_user_id?: string | null
  /** Pilot inbound email — set for JOB_INBOUND_EMAIL_ORG_SLUGS orgs only. */
  inbound_email_token?: string | null
  /** Populated by GET /api/jobs/[id] when pilot org; not a DB column. */
  inbound_email_address?: string | null
}

export interface Photo {
  id: string
  job_id: string
  file_url: string
  caption: string
  area_ref: string
  category: PhotoCategory
  /** Capture workflow marker to separate assessment vs progress evidence. */
  capture_phase?: PhotoCapturePhase
  /** When false, omitted from composed quote/SOW/report/PDF outputs (default true). */
  include_in_composed_reports?: boolean
  uploaded_at: string
}

/** Job-scoped progress notes (DB table `progress_notes`). */
export interface ProgressNote {
  id: string
  org_id: string
  job_id: string
  room: string
  body: string
  created_at: string
  updated_at: string
  created_by_user_id: string
  updated_by_user_id: string
  created_by_first_name: string
  updated_by_first_name: string
  archived_at: string | null
  archived_by_user_id: string | null
  archived_by_first_name: string | null
  deleted_at: string | null
  deleted_by_user_id: string | null
  deleted_by_first_name: string | null
}

/** Room-level notes in Progress Photos (during/after narrative). */
export interface ProgressRoomNote {
  id: string
  org_id: string
  job_id: string
  room_name: string
  note: string
  created_at: string
  updated_at: string
  created_by_user_id: string
  updated_by_user_id: string
  created_by_first_name: string
  updated_by_first_name: string
}

/** One AI/manual line item row grouped by room for quote drafting. */
export interface QuoteLineItemRow {
  id: string
  run_id: string
  org_id: string
  job_id: string
  room_name: string
  description: string
  qty: number
  unit: string
  rate: number
  total: number
  sort_order: number
  source: 'ai' | 'manual'
  created_at: string
  updated_at: string
  created_by_user_id: string
  updated_by_user_id: string
  deleted_at: string | null
}

/** Suggestion run snapshot; one active run per job. */
export interface QuoteLineItemRun {
  id: string
  org_id: string
  job_id: string
  target_amount: number | null
  target_price_note: string
  /** When true, merged quote/PDF uses line sum as ex-GST subtotal, adds 10% GST, total inc-GST. */
  add_gst_to_total?: boolean
  is_active: boolean
  source_hash?: string | null
  source_schema_version?: number
  generated_at?: string | null
  generated_by_user_id?: string | null
  created_at: string
  created_by_user_id: string
}

export interface Document {
  id: string
  job_id: string
  type: DocType
  content: Record<string, unknown>
  file_url: string | null
  created_at: string
}

/** Ordered saved documents → one composed print (/api/print/bundle/[id]). */
export interface DocumentBundle {
  id: string
  job_id: string
  org_id: string | null
  title: string
  part_document_ids: string[]
  created_at: string
  updated_at: string
}

/* Per-org company branding and settings. One row per org in company_profile.
   document_rules: 'general' + per DocType prose keys; optional [type]_pdf URLs;
   optional [type]_template_json (string of JSON) for structured template hints. */
export interface CompanyProfile {
  id: string
  name: string
  abn: string
  phone: string
  email: string
  address: string
  licence: string
  tagline: string
  logo_url: string | null
  subdomain: string | null
  custom_domain: string | null
  updated_at: string
  document_rules?: Record<string, string>  // general + per-type rules (biohazards.md)
}

// ── Line items (Quote, Engagement Agreement) ──────────────────────────────────

export interface LineItem {
  description: string
  qty: number
  unit: string
  rate: number
  total: number
}

// ── SWMS / JSA step ───────────────────────────────────────────────────────────

export interface WorkStep {
  step: string          // task description
  hazards: string       // identified hazards
  risk_before: string   // risk rating before controls (H/M/L)
  controls: string      // control measures
  risk_after: string    // residual risk rating
  responsible: string   // person responsible
}

// ── Risk row (Risk Assessment) ────────────────────────────────────────────────

export interface RiskRow {
  hazard: string
  likelihood: string    // H/M/L
  consequence: string   // H/M/L
  risk_rating: string   // H/M/L
  controls: string
  residual_risk: string // H/M/L
}

// ── Waste item ────────────────────────────────────────────────────────────────

export interface WasteItem {
  description: string
  quantity: string
  unit: string
  disposal_method: string
  facility: string
}

// ── Document content types ────────────────────────────────────────────────────

export interface QuoteContent {
  title: string
  reference: string
  intro: string
  line_items: LineItem[]
  /** Outcome-based quote rows (preferred render path when present). */
  outcome_rows?: OutcomeQuoteRow[]
  /** Controls quote output layout preference when merging live quote capture content. */
  outcome_mode?: 'outcomes' | 'line_items'
  subtotal: number
  gst: number
  total: number
  notes: string
  payment_terms: string
  validity: string
  include_photos?: boolean
  /** Staff / internal completion line; client signing is via PandaDoc, not in-app */
  completed_by?: string
}

/** Formal assessment document stored in `documents` (composer + print); aligns with AssessmentDocumentCapture narrative fields. */
export interface AssessmentDocumentContent {
  title: string
  reference: string
  site_summary: string
  hazards_overview: string
  risks_overview: string
  control_measures: string
  recommendations: string
  limitations: string
  completed_by?: string
}

export interface SOWContent {
  title: string
  reference: string
  executive_summary: string
  scope: string
  methodology: string
  safety_protocols: string
  waste_disposal: string
  timeline: string
  exclusions: string
  disclaimer: string
  include_photos?: boolean
  /** Name or role for internal completion line; client signing via PandaDoc */
  completed_by?: string
  /** @deprecated Ignored in print — retained for legacy saved JSON */
  acceptance?: string
  /** Optional print meta — filled by compose from job when available */
  meta_site_address?: string
  meta_area_label?: string
  meta_priority?: string
}

export interface SWMSContent {
  title: string
  reference: string
  project_details: string
  steps: WorkStep[]
  ppe_required: string
  emergency_procedures: string
  legislation_references: string
  declarations: string
  completed_by?: string
}

export interface AuthorityToProceedContent {
  title: string
  reference: string
  scope_summary: string
  access_details: string
  special_conditions: string
  liability_acknowledgment: string
  payment_authorisation: string
  completed_by?: string
  /** @deprecated Legacy */
  acceptance?: string
}

export interface EngagementAgreementContent {
  title: string
  reference: string
  parties: string
  services_description: string
  fees_and_payment: string
  liability_limitations: string
  confidentiality: string
  dispute_resolution: string
  termination: string
  governing_law: string
  completed_by?: string
  /** @deprecated Legacy */
  acceptance?: string
}

/** Execute-phase silo text; completion report assembly prefers this when staff fields are empty. */
export interface PerExecuteCapture {
  recommendations: string
  quality_checks: string
  waste_manifest_notes: string
}

/** Completion Report field capture — aligns with ReportContent narrative sections. */
export interface CompletionReportCapture {
  executive_summary: string
  site_conditions: string
  works_carried_out: string
  methodology: string
  products_used: string
  waste_disposal: string
  photo_record: string
  outcome: string
  technician_signoff: string
}

export interface ReportContent {
  title: string
  reference: string
  executive_summary: string
  site_conditions: string
  works_carried_out: string
  methodology: string
  products_used: string
  waste_disposal: string
  photo_record: string
  outcome: string
  technician_signoff: string
  include_photos?: boolean
  completed_by?: string
}

export interface CertificateOfDecontaminationContent {
  title: string
  reference: string
  date_of_works: string
  works_summary: string
  decontamination_standard: string
  products_used: string
  outcome_statement: string
  limitations: string
  certifier_statement: string
  completed_by?: string
}

export interface WasteDisposalManifestContent {
  title: string
  reference: string
  collection_date: string
  waste_items: WasteItem[]
  transport_details: string
  declaration: string
  completed_by?: string
}

export interface JSAContent {
  title: string
  reference: string
  job_description: string
  steps: WorkStep[]
  ppe_required: string
  emergency_contacts: string
  sign_off: string
  completed_by?: string
}

export interface NDAContent {
  title: string
  reference: string
  parties: string
  confidential_information_definition: string
  obligations: string
  exceptions: string
  term: string
  remedies: string
  governing_law: string
  completed_by?: string
  /** @deprecated Legacy */
  acceptance?: string
}

export interface RiskAssessmentContent {
  title: string
  reference: string
  site_description: string
  assessment_date: string
  assessor: string
  risks: RiskRow[]
  overall_risk_rating: string
  recommendations: string
  review_date: string
  completed_by?: string
}

export type AnyDocContent =
  | QuoteContent
  | SOWContent
  | AssessmentDocumentContent
  | SWMSContent
  | AuthorityToProceedContent
  | EngagementAgreementContent
  | ReportContent
  | CertificateOfDecontaminationContent
  | WasteDisposalManifestContent
  | JSAContent
  | NDAContent
  | RiskAssessmentContent

/* Photo with an optional base64 data URL, used when embedding images
   into react-pdf renders (which cannot fetch remote URLs directly). */
export interface PhotoWithData extends Photo {
  dataUrl?: string
}

// ── Multi-tenant ──────────────────────────────────────────────────────────────

/* Top-level tenant record. Every job, person, document, and photo belongs to
   an org via org_id. is_active is used for soft-delete / suspension. */
export interface Org {
  id: string
  name: string
  slug: string
  custom_domain?: string
  plan: 'solo' | 'team' | 'business'
  seat_limit: number
  /** Platform-tunable flags: `show_quick_feedback`, `training_education`, `website_card` (public site / marketing entry on home), etc. */
  features: Record<string, boolean>
  is_active: boolean
  created_at: string
}

/*
 * TeamCapabilities — capabilities-based permission model.
 *
 * Rather than checking role === 'admin' throughout the UI, every permission
 * gate checks a specific capability here. This allows admins to grant
 * individual capabilities to members without promoting them to full admin.
 *
 * assign_team_members is a 3-level enum:
 *   'none'  — cannot assign team to any job
 *   'own'   — can assign on jobs they are already assigned to
 *   'all'   — can assign on any job
 *
 * Admins always receive ALL_CAPABILITIES. Members receive
 * DEFAULT_MEMBER_CAPABILITIES merged with their custom caps from org_users.capabilities.
 * Preview mode (admin-only) replaces the in-memory caps with caps from
 * localStorage 'preview_caps' so admins can test member experience.
 */
export interface TeamCapabilities {
  // Jobs
  view_all_jobs:       boolean
  create_jobs:         boolean
  edit_job_details:    boolean
  change_job_status:   boolean
  assign_team_members: 'none' | 'own' | 'all'
  // Assessment
  view_assessment:     boolean
  edit_assessment:     boolean
  use_smartfill:       boolean
  // Quote
  view_quote:          boolean
  edit_quote:          boolean
  // Documents
  generate_documents:  boolean
  edit_documents:      boolean
  send_documents:      boolean
  // Photos
  upload_photos_assigned: boolean
  upload_photos_any:   boolean
  // Team
  invite_team_members: boolean
  view_team_profiles:  boolean
  // Messaging
  send_sms:            boolean
  // Settings
  edit_settings:       boolean
}

/* Full access — assigned to every admin/owner. */
export const ALL_CAPABILITIES: TeamCapabilities = {
  view_all_jobs: true, create_jobs: true, edit_job_details: true,
  change_job_status: true, assign_team_members: 'all',
  view_assessment: true, edit_assessment: true, use_smartfill: true,
  view_quote: true, edit_quote: true,
  generate_documents: true, edit_documents: true, send_documents: true,
  upload_photos_assigned: true, upload_photos_any: true,
  invite_team_members: true, view_team_profiles: true,
  send_sms: true, edit_settings: true,
}

/* Manager defaults — oversees jobs and team, no admin settings/pricing/docs. */
export const DEFAULT_MANAGER_CAPABILITIES: TeamCapabilities = {
  view_all_jobs: true, create_jobs: true, edit_job_details: true,
  change_job_status: true, assign_team_members: 'all',
  view_assessment: true, edit_assessment: true, use_smartfill: true,
  view_quote: true, edit_quote: false,
  generate_documents: false, edit_documents: false, send_documents: false,
  upload_photos_assigned: true, upload_photos_any: true,
  invite_team_members: true, view_team_profiles: true,
  send_sms: true, edit_settings: false,
}

/* Minimum access for a field worker. Merged with any custom capabilities
   stored in org_users.capabilities so admins can selectively unlock more. */
export const DEFAULT_MEMBER_CAPABILITIES: TeamCapabilities = {
  view_all_jobs: false, create_jobs: false, edit_job_details: false,
  change_job_status: false, assign_team_members: 'none',
  view_assessment: false, edit_assessment: false, use_smartfill: false,
  view_quote: false, edit_quote: false,
  generate_documents: false, edit_documents: false, send_documents: false,
  upload_photos_assigned: true, upload_photos_any: false,
  invite_team_members: false, view_team_profiles: false,
  send_sms: false, edit_settings: false,
}

/* Join table linking a Clerk user to an org. person_id links to the people
   table so a team member's org_user row can reference their staff profile. */
export interface OrgUser {
  id: string
  org_id: string
  clerk_user_id: string
  role: 'admin' | 'manager' | 'team_lead' | 'member' | 'client' | 'property_manager' | 'body_corp' | 'platform_owner' | 'platform_admin'
  capabilities: TeamCapabilities
  person_id: string | null
  is_active: boolean
  created_at: string
}
