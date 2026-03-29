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

export type DocType = 'quote' | 'sow' | 'report'

export interface Area {
  name: string
  sqm: number
  hazard_level: number
  description: string
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
  gst_treatment?: 'inclusive' | 'exclusive' | 'none'
}

export interface Job {
  id: string
  status: JobStatus
  urgency: JobUrgency
  job_type: JobType
  client_name: string
  client_phone: string
  client_email: string
  site_address: string
  notes: string
  assessment_data: AssessmentData | null
  created_at: string
  updated_at: string
}

export interface Photo {
  id: string
  job_id: string
  file_url: string
  caption: string
  area_ref: string        // which room/area this photo documents
  category: PhotoCategory
  uploaded_at: string
}

export interface Document {
  id: string
  job_id: string
  type: DocType
  content: object
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
  subdomain: string | null       // e.g. "brisbane" → brisbane.biohazards.net
  custom_domain: string | null   // e.g. "app.hazmatpro.com.au"
  updated_at: string
}

// Claude-generated document structures
export interface LineItem {
  description: string
  qty: number
  unit: string
  rate: number
  total: number
}

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
}

// Photo with base64 data for PDF embedding
export interface PhotoWithData extends Photo {
  dataUrl?: string
}
