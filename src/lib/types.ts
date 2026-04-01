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

export interface Area {
  name: string
  sqm: number
  hazard_level: number
  description: string
}

export interface CustomField {
  label: string
  value: string
}

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

export interface PhoneEntry {
  label: string   // "Mobile", "Landline", "Work", "Other"
  number: string
}

export interface Job {
  id: string
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

// Photo with proxy URL for PDF embedding
export interface PhotoWithData extends Photo {
  dataUrl?: string
}

// ── Multi-tenant ──────────────────────────────────────────────────────────────

export interface Org {
  id: string
  name: string
  slug: string
  custom_domain?: string
  plan: 'solo' | 'team' | 'business'
  seat_limit: number
  features: Record<string, boolean>
  is_active: boolean
  created_at: string
}

export interface OrgUser {
  id: string
  org_id: string
  clerk_user_id: string
  role: 'owner' | 'operator' | 'field'
  is_active: boolean
  created_at: string
}
