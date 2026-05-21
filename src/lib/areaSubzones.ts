/*
 * lib/areaSubzones.ts
 *
 * Per-room dimensions inside a multi-name Area. When an area name combines
 * several rooms with the ` + ` separator (e.g. "Master bedroom + Ensuite +
 * Walk-in robe"), each room can have its own L × W × H; the area's effective
 * floor / ceiling / walls / total surface / volume are sums across all
 * subzones. Single-name areas keep their existing top-level dims unchanged.
 *
 * The helpers here are the single source of truth for "what are this area's
 * dimensions, really?" across the Assessment UI, the Quote tab, the printed
 * tables (HTML + PDF), and the AI presentation context. Any consumer that
 * still reads area.length_m / width_m / height_m directly will quietly
 * disagree with the rest of the app once subzones are present — funnel reads
 * through `effectiveAreaDimensions` instead.
 */

import type { Area, AreaSubzone } from '@/lib/types'
import { deriveSurfaceAreas } from '@/lib/areaSurfaces'
import { splitAreaName } from '@/lib/areaRoomTypes'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function makeSubzoneId(seed: number): string {
  return `sz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${seed}`
}

/** True when the area's name has 2+ parts (chips). Driver for showing the
 *  per-subzone dimension editor instead of a single L × W × H row. */
export function isMultiZoneArea(area: Area | null | undefined): boolean {
  return splitAreaName(area?.name ?? '').length >= 2
}

/**
 * Return the subzones the rest of the app should treat as the source of truth.
 *
 * - If `area.subzones` is set and non-empty, return it verbatim (the user has
 *   committed to subzone-driven dims).
 * - Otherwise, if the area name has 2+ parts, lazily derive one subzone per
 *   part. The FIRST derived subzone inherits the area's top-level L/W/H so
 *   existing data isn't orphaned the moment a chip is added.
 * - Otherwise (single-name area), return [] — caller should fall back to
 *   area.length_m / width_m / height_m.
 */
export function getEffectiveSubzones(area: Area): AreaSubzone[] {
  if (area.subzones && area.subzones.length > 0) return area.subzones
  const parts = splitAreaName(area.name)
  if (parts.length < 2) return []
  const L = Math.max(0, Number(area.length_m ?? 0))
  const W = Math.max(0, Number(area.width_m ?? 0))
  const H = Math.max(0, Number(area.height_m ?? 0))
  return parts.map((name, i) => ({
    id: makeSubzoneId(i),
    name,
    length_m: i === 0 ? L : 0,
    width_m: i === 0 ? W : 0,
    height_m: i === 0 ? H : 0,
  }))
}

export interface SubzoneSurfaces extends AreaSubzone {
  floor: number
  ceiling: number
  walls: number
  totalSurface: number
  volume: number
  /** True if at least one geometry value (floor / walls / volume) is non-zero. */
  hasDims: boolean
}

/** Per-subzone surface / volume breakdown using the existing deriveSurfaceAreas formula. */
function subzoneWithSurfaces(s: AreaSubzone): SubzoneSurfaces {
  const L = Math.max(0, Number(s.length_m || 0))
  const W = Math.max(0, Number(s.width_m || 0))
  const H = Math.max(0, Number(s.height_m || 0))
  const surfaces = deriveSurfaceAreas(L, W, H)
  const floor = surfaces.floor
  const ceiling = surfaces.ceiling
  const walls = surfaces.walls
  const totalSurface = round2(floor + ceiling + walls)
  const volume = floor > 0 && H > 0 ? round2(floor * H) : 0
  return {
    ...s,
    length_m: L,
    width_m: W,
    height_m: H,
    floor,
    ceiling,
    walls,
    totalSurface,
    volume,
    hasDims: floor > 0 || walls > 0 || volume > 0,
  }
}

export interface EffectiveAreaDimensions {
  /** Aggregated floor area (m²) — sum of subzone floors, or single-zone L×W. */
  floor: number
  ceiling: number
  walls: number
  totalSurface: number
  volume: number
  /** Single-zone tape-measure values; null for multi-zone areas because the
   *  aggregate is no longer a rectangle. */
  length: number | null
  width: number | null
  height: number | null
  /** True for multi-zone areas (subzones-driven aggregation). */
  isMultiZone: boolean
  /** Per-subzone breakdown for printed tables; empty array for single-zone areas. */
  subzones: SubzoneSurfaces[]
  /** True if any geometry value rolled up to a non-zero number. */
  hasDims: boolean
}

/**
 * The canonical "what are this area's dimensions" lookup. Single-zone areas
 * fall back to area.length_m / width_m / height_m (and area.sqm as a legacy
 * floor area when L/W aren't both present). Multi-zone areas sum across
 * subzones.
 */
export function effectiveAreaDimensions(area: Area): EffectiveAreaDimensions {
  const subzones = getEffectiveSubzones(area)
  if (subzones.length > 0) {
    const detailed = subzones.map(subzoneWithSurfaces)
    const floor = round2(detailed.reduce((s, r) => s + r.floor, 0))
    const ceiling = round2(detailed.reduce((s, r) => s + r.ceiling, 0))
    const walls = round2(detailed.reduce((s, r) => s + r.walls, 0))
    const totalSurface = round2(floor + ceiling + walls)
    const volume = round2(detailed.reduce((s, r) => s + r.volume, 0))
    return {
      floor,
      ceiling,
      walls,
      totalSurface,
      volume,
      length: null,
      width: null,
      height: null,
      isMultiZone: true,
      subzones: detailed,
      hasDims: floor > 0 || walls > 0 || volume > 0,
    }
  }
  // Single-zone fall-through: use top-level dims, with area.sqm as a legacy
  // fallback when only a manual floor area was captured.
  const L = Math.max(0, Number(area.length_m ?? 0))
  const W = Math.max(0, Number(area.width_m ?? 0))
  const H = Math.max(0, Number(area.height_m ?? 0))
  const manualSqm = Math.max(0, Number(area.sqm ?? 0))
  const surfaces = deriveSurfaceAreas(L, W, H)
  const floor = surfaces.floor > 0 ? surfaces.floor : manualSqm
  const ceiling = surfaces.ceiling > 0 ? surfaces.ceiling : floor
  const walls = surfaces.walls
  const totalSurface = round2(floor + ceiling + walls)
  const volume = floor > 0 && H > 0 ? round2(floor * H) : 0
  return {
    floor,
    ceiling,
    walls,
    totalSurface,
    volume,
    length: L > 0 ? L : null,
    width: W > 0 ? W : null,
    height: H > 0 ? H : null,
    isMultiZone: false,
    subzones: [],
    hasDims: floor > 0 || walls > 0 || volume > 0,
  }
}

/**
 * Keep `area.subzones` aligned with the parts of `area.name`. Called whenever
 * the area's chip-based name changes so subzone identity tracks the chips:
 *
 *   - Going from 1 → 2+ parts (first time): create subzones for each new part.
 *     The FIRST subzone inherits the area's existing top-level L/W/H so no
 *     captured data is lost.
 *   - Going from N → M parts (both ≥ 2): preserve subzones whose names match
 *     a current part; drop orphans; append blanks for new parts.
 *   - Going from 2+ → 1 part: collapse back to single-zone mode. Copy the
 *     surviving subzone's dims into top-level L/W/H so the data persists.
 *   - Single → single: untouched.
 *
 * Pure: returns a (possibly new) Area; callers replace the area in their
 * state with the result.
 */
export function syncAreaSubzonesWithName(area: Area): Area {
  const parts = splitAreaName(area.name)

  // Collapse back to single-zone
  if (parts.length <= 1) {
    if (area.subzones && area.subzones.length > 0) {
      const matching = area.subzones.find(
        s => s.name.trim().toLowerCase() === (parts[0] ?? '').trim().toLowerCase(),
      )
      const surviving = matching ?? area.subzones[0]
      const L = Math.max(0, Number(surviving.length_m || 0))
      const W = Math.max(0, Number(surviving.width_m || 0))
      const H = Math.max(0, Number(surviving.height_m || 0))
      return {
        ...area,
        length_m: L,
        width_m: W,
        height_m: H,
        sqm: L > 0 && W > 0 ? round2(L * W) : area.sqm,
        subzones: undefined,
      }
    }
    return area
  }

  // Multi-zone — align subzones[] with the chip parts (preserving by name match)
  const prev = area.subzones ?? []
  const byName = new Map(prev.map(s => [s.name.trim().toLowerCase(), s]))
  const next: AreaSubzone[] = parts.map((p, i) => {
    const existing = byName.get(p.trim().toLowerCase())
    if (existing) return { ...existing, name: p }
    return { id: makeSubzoneId(i), name: p, length_m: 0, width_m: 0, height_m: 0 }
  })

  // First time going multi-zone: migrate the area's top-level dims into the
  // first subzone so the staff don't lose what they already typed.
  if (prev.length === 0) {
    const topL = Math.max(0, Number(area.length_m ?? 0))
    const topW = Math.max(0, Number(area.width_m ?? 0))
    const topH = Math.max(0, Number(area.height_m ?? 0))
    if (topL > 0 || topW > 0 || topH > 0) {
      next[0] = { ...next[0], length_m: topL, width_m: topW, height_m: topH }
    }
  }

  return { ...area, subzones: next }
}

/** Apply a per-subzone dimension edit, materialising area.subzones if needed.
 *  Safe to call regardless of whether `area.subzones` was set or lazily
 *  derived from name parts. */
export function updateAreaSubzoneDim(
  area: Area,
  subzoneId: string,
  field: 'length_m' | 'width_m' | 'height_m',
  value: number,
): Area {
  const safe = Number.isFinite(value) && value >= 0 ? value : 0
  const current = getEffectiveSubzones(area)
  const next = current.map(s => (s.id === subzoneId ? { ...s, [field]: safe } : s))
  return { ...area, subzones: next }
}
