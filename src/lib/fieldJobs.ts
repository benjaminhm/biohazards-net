import type { JobStatus, JobType, JobUrgency, PhotoCategory, PhotoCapturePhase } from '@/lib/types'

export const ACTIVE_FIELD_STATUSES: JobStatus[] = ['lead', 'assessed', 'quoted', 'accepted', 'scheduled', 'underway']

export const FIELD_JOB_SELECT = [
  'id',
  'status',
  'urgency',
  'job_type',
  'site_address',
  'site_lat',
  'site_lng',
  'access_notes',
  'scheduled_at',
  'schedule_note',
  'created_at',
  'updated_at',
].join(', ')

export interface FieldJob {
  id: string
  status: JobStatus
  urgency: JobUrgency
  job_type: JobType
  site_address: string
  site_lat: number | null
  site_lng: number | null
  access_notes: string | null
  scheduled_at: string | null
  schedule_note: string | null
  created_at: string
  updated_at: string
}

export type FieldJobRow = FieldJob

export interface FieldPhoto {
  id: string
  job_id: string
  file_url: string
  caption: string
  area_ref: string
  category: PhotoCategory
  capture_phase?: PhotoCapturePhase
  uploaded_at: string
}

export interface FieldTeamContact {
  id: string
  name: string
  role: string
  phone: string | null
  email: string | null
  app_role: string
}

export interface FieldCapabilities {
  upload_photos_assigned: boolean
  upload_photos_any: boolean
  send_sms: boolean
}

export interface FieldAccess {
  role: string
  personId: string | null
  canViewAllJobs: boolean
  capabilities: FieldCapabilities
}

export interface OrgUserAccessRow {
  role: string | null
  person_id: string | null
  capabilities: Record<string, unknown> | null
}

export function resolveFieldAccess(row: OrgUserAccessRow | null): FieldAccess | null {
  if (!row) return null
  const role = row.role ?? 'member'
  const caps = row.capabilities ?? {}
  const privilegedRole = role === 'admin' || role === 'owner' || role === 'manager' || role === 'team_lead'

  return {
    role,
    personId: row.person_id ?? null,
    canViewAllJobs: privilegedRole || caps.view_all_jobs === true,
    capabilities: {
      upload_photos_assigned: caps.upload_photos_assigned === true,
      upload_photos_any: caps.upload_photos_any === true,
      send_sms: caps.send_sms === true,
    },
  }
}

export function sanitizeFieldJob(row: FieldJobRow): FieldJob {
  return {
    id: row.id,
    status: row.status,
    urgency: row.urgency,
    job_type: row.job_type,
    site_address: row.site_address,
    site_lat: row.site_lat ?? null,
    site_lng: row.site_lng ?? null,
    access_notes: row.access_notes ?? null,
    scheduled_at: row.scheduled_at ?? null,
    schedule_note: row.schedule_note ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}
