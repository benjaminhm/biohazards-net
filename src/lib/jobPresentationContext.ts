/*
 * Shared presentation snapshot for suggest-risks, suggest-sow-capture, etc.
 */
import type { AssessmentData, JobType } from '@/lib/types'
import { effectiveAreaDimensions } from '@/lib/areaSubzones'

export type PresentationContextPhoto = {
  area_ref: string | null
  category: string
  caption: string | null
}

/**
 * Per-area surface measurements derived from the captured dimensions, suitable
 * for the AI suggesters to cite directly. Mirrors the formula used by the
 * printed Assessment Document / SOW / Quote so the AI never disagrees with
 * the deterministic table rendered in the documents.
 *
 * For multi-zone areas (per-room subzones), `length_m / width_m / height_m`
 * are null (the aggregate is no longer a rectangle) and `subzones` carries
 * the per-room breakdown that produced the floor / walls / ceiling sums.
 */
export type PresentationContextAreaDimensions = {
  length_m: number | null
  width_m: number | null
  height_m: number | null
  floor_m2: number | null
  ceiling_m2: number | null
  walls_m2: number | null
  total_surface_m2: number | null
  volume_m3: number | null
  /** Present only for multi-zone areas. Each entry is one of the rooms
   *  inside this area with its own measurements. */
  subzones?: {
    name: string
    length_m: number | null
    width_m: number | null
    height_m: number | null
    floor_m2: number | null
    walls_m2: number | null
    volume_m3: number | null
  }[]
}

export type PresentationContext = {
  job_type: JobType
  site_address: string
  urgency: string | null
  job_notes: string | null
  estimated_hours: number | null
  estimated_waste_litres: number | null
  areas: {
    name: string
    description: string
    hazard_level: number
    dimensions: PresentationContextAreaDimensions | null
  }[]
  contamination_level: number | null
  biohazard_type: string | null
  observations: string | null
  access_restrictions: string | null
  special_risks: AssessmentData['special_risks'] | null
  ppe_required: AssessmentData['ppe_required'] | null
  photos: PresentationContextPhoto[]
}

export function hasPresentationGrounding(payload: {
  biohazard_type: string | null
  observations: string | null
  access_restrictions: string | null
  areas: { name: string; description: string }[]
  photos: { area_ref: string | null; caption: string | null }[]
  special_risks: AssessmentData['special_risks'] | null
  ppe_required: AssessmentData['ppe_required'] | null
}): boolean {
  const t = [
    payload.biohazard_type,
    payload.observations,
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

function areaDimensionsFor(a: AssessmentData['areas'][number]): PresentationContextAreaDimensions | null {
  const dims = effectiveAreaDimensions(a)
  if (!dims.hasDims) return null
  return {
    length_m: dims.length,
    width_m: dims.width,
    height_m: dims.height,
    floor_m2: dims.floor > 0 ? dims.floor : null,
    ceiling_m2: dims.ceiling > 0 ? dims.ceiling : null,
    walls_m2: dims.walls > 0 ? dims.walls : null,
    total_surface_m2: dims.totalSurface > 0 ? dims.totalSurface : null,
    volume_m3: dims.volume > 0 ? dims.volume : null,
    subzones: dims.isMultiZone
      ? dims.subzones.map(sz => ({
          name: sz.name,
          length_m: sz.length_m > 0 ? sz.length_m : null,
          width_m: sz.width_m > 0 ? sz.width_m : null,
          height_m: sz.height_m > 0 ? sz.height_m : null,
          floor_m2: sz.floor > 0 ? sz.floor : null,
          walls_m2: sz.walls > 0 ? sz.walls : null,
          volume_m3: sz.volume > 0 ? sz.volume : null,
        }))
      : undefined,
  }
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
      dimensions: areaDimensionsFor(a),
    })),
    contamination_level: ad?.contamination_level ?? null,
    biohazard_type: (ad?.biohazard_type || '').trim() || null,
    observations: (ad?.observations || '').trim() || null,
    access_restrictions: (ad?.access_restrictions || '').trim() || null,
    special_risks: ad?.special_risks ?? null,
    ppe_required: ad?.ppe_required ?? null,
    photos: input.photos,
  }
}
