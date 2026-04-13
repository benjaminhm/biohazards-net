/*
 * Shared presentation snapshot for suggest-risks, suggest-sow-capture, etc.
 */
import type { AssessmentData, JobType } from '@/lib/types'

export type PresentationContextPhoto = {
  area_ref: string | null
  category: string
  caption: string | null
}

export type PresentationContext = {
  job_type: JobType
  site_address: string
  urgency: string | null
  job_notes: string | null
  estimated_hours: number | null
  estimated_waste_litres: number | null
  areas: { name: string; description: string; hazard_level: number }[]
  contamination_level: number | null
  biohazard_type: string | null
  observations: string | null
  manual_location: string | null
  access_restrictions: string | null
  special_risks: AssessmentData['special_risks'] | null
  ppe_required: AssessmentData['ppe_required'] | null
  photos: PresentationContextPhoto[]
}

export function hasPresentationGrounding(payload: {
  biohazard_type: string | null
  observations: string | null
  manual_location?: string | null
  access_restrictions: string | null
  areas: { name: string; description: string }[]
  photos: { area_ref: string | null; caption: string | null }[]
  special_risks: AssessmentData['special_risks'] | null
  ppe_required: AssessmentData['ppe_required'] | null
}): boolean {
  const t = [
    payload.biohazard_type,
    payload.observations,
    payload.manual_location,
    payload.access_restrictions,
    ...payload.areas.flatMap(a => [a.name, a.description]),
    ...payload.photos.flatMap(p => [p.caption, p.area_ref].filter(Boolean) as string[]),
  ]
    .join(' ')
    .trim()
  if (t.length >= 8) return true
  if (payload.special_risks && Object.values(payload.special_risks).some(Boolean)) return true
  if (payload.ppe_required && Object.values(payload.ppe_required).some(Boolean)) return true
  return false
}

export function buildPresentationContext(input: {
  job_type: JobType
  site_address: string
  urgency: string | null | undefined
  notes: string | null | undefined
  assessment_data: AssessmentData | null
  photos: PresentationContextPhoto[]
}): PresentationContext {
  const ad = input.assessment_data
  return {
    job_type: input.job_type,
    site_address: input.site_address,
    urgency: input.urgency ?? null,
    job_notes: (input.notes || '').trim() || null,
    estimated_hours: ad?.estimated_hours ?? null,
    estimated_waste_litres: ad?.estimated_waste_litres ?? null,
    areas: (ad?.areas ?? []).map(a => ({
      name: (a.name || '').trim(),
      description: (a.description || '').trim(),
      hazard_level: a.hazard_level ?? 1,
    })),
    contamination_level: ad?.contamination_level ?? null,
    biohazard_type: (ad?.biohazard_type || '').trim() || null,
    observations: (ad?.observations || '').trim() || null,
    manual_location: (ad?.manual_location || '').trim() || null,
    access_restrictions: (ad?.access_restrictions || '').trim() || null,
    special_risks: ad?.special_risks ?? null,
    ppe_required: ad?.ppe_required ?? null,
    photos: input.photos,
  }
}
