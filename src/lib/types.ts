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

export type DocType =
  | 'quote'
  | 'sow'
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
  quote:                      'Quote',
  sow:                        'Scope of Work',
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

export const DOC_TYPE_GROUPS: { label: string; types: DocType[] }[] = [
  {
    label: 'Before Works',
    types: ['quote', 'sow', 'swms', 'authority_to_proceed', 'engagement_agreement', 'jsa', 'risk_assessment', 'nda'],
  },
  {
    label: 'After Works',
    types: ['report', 'certificate_of_decontamination', 'waste_disposal_manifest'],
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
  uploaded_at: string
}

export interface Document {
  id: string
  job_id: string
  type: DocType
  content: Record<string, unknown>
  file_url: string | null
  created_at: string
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
  subtotal: number
  gst: number
  total: number
  notes: string
  payment_terms: string
  validity: string
  include_photos?: boolean
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
  acceptance: string
  include_photos?: boolean
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
}

export interface AuthorityToProceedContent {
  title: string
  reference: string
  scope_summary: string
  access_details: string
  special_conditions: string
  liability_acknowledgment: string
  payment_authorisation: string
  acceptance: string
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
  acceptance: string
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
}

export interface WasteDisposalManifestContent {
  title: string
  reference: string
  collection_date: string
  waste_items: WasteItem[]
  transport_details: string
  declaration: string
}

export interface JSAContent {
  title: string
  reference: string
  job_description: string
  steps: WorkStep[]
  ppe_required: string
  emergency_contacts: string
  sign_off: string
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
  acceptance: string
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
}

export type AnyDocContent =
  | QuoteContent
  | SOWContent
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
