/*
 * Shared presentation snapshot for suggest-risks, suggest-sow-capture, etc.
 */
import type { AssessmentData, JobType } from '@/lib/types'
import { deriveSurfaceAreas } from '@/lib/areaSurfaces'

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
  const L = Math.max(0, Number(a.length_m ?? 0))
  const W = Math.max(0, Number(a.width_m ?? 0))
  const H = Math.max(0, Number(a.height_m ?? 0))
  const manualSqm = Math.max(0, Number(a.sqm ?? 0))
  if (L === 0 && W === 0 && H === 0 && manualSqm === 0) return null
  const round2 = (n: number) => Math.round(n * 100) / 100
  const surfaces = deriveSurfaceAreas(L, W, H)
  const floor = surfaces.floor > 0 ? surfaces.floor : manualSqm
  const ceiling = surfaces.ceiling > 0 ? surfaces.ceiling : floor
  const walls = surfaces.walls
  const totalSurface = round2(floor + ceiling + walls)
  const volume = floor > 0 && H > 0 ? round2(floor * H) : 0
  return {
    length_m: L > 0 ? L : null,
    width_m: W > 0 ? W : null,
    height_m: H > 0 ? H : null,
    floor_m2: floor > 0 ? floor : null,
    ceiling_m2: ceiling > 0 ? ceiling : null,
    walls_m2: walls > 0 ? walls : null,
    total_surface_m2: totalSurface > 0 ? totalSurface : null,
    volume_m3: volume > 0 ? volume : null,
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
