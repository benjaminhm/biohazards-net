/*
 * lib/areaSurfaces.ts
 *
 * Pure geometry + helpers for per-surface room pricing.
 *
 * The Quote tab lets staff price each room broken into three surfaces — Floor,
 * Walls (combined), and Ceiling — so a single set of length/width/height
 * inputs in the Assessment can drive a sensible m² figure for each surface
 * without making the tech compute perimeters by hand.
 *
 * Conventions:
 *  - Floor area    = L × W
 *  - Walls area    = 2 × (L + W) × H            (combined; openings ignored — close enough for quoting)
 *  - Ceiling area  = L × W                      (flat ceiling assumption; vaulted rooms are an override edge case)
 *
 * `included = false` means the surface is OUT of scope — it surfaces in the
 * printed quote's "Excluded from this quote" list and contributes $0.
 * `included = true, unit_price_per_sqm = 0` means in-scope at $0 (e.g. token
 * inclusion); the line still prints in the per-room table.
 */

import type { AreaPricingRow, SurfaceKind, SurfacePricingLine } from '@/lib/types'

export const SURFACE_KINDS: readonly SurfaceKind[] = ['floor', 'walls', 'ceiling'] as const

export const SURFACE_LABELS: Record<SurfaceKind, string> = {
  floor: 'Floor',
  walls: 'Walls',
  ceiling: 'Ceiling',
}

/**
 * Default include flags for a brand-new room — biohazard scope almost always
 * touches floors and walls; ceilings are usually only added when fogging,
 * spatter remediation, or smoke / odour work is in scope.
 */
export const SURFACE_DEFAULT_INCLUDED: Record<SurfaceKind, boolean> = {
  floor: true,
  walls: true,
  ceiling: false,
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Pure geometry: derive Floor / Walls / Ceiling areas (m²) from rectangular dimensions. */
export function deriveSurfaceAreas(
  lengthM: number,
  widthM: number,
  heightM: number,
): Record<SurfaceKind, number> {
  const L = Math.max(0, Number(lengthM) || 0)
  const W = Math.max(0, Number(widthM) || 0)
  const H = Math.max(0, Number(heightM) || 0)
  return {
    floor: round2(L * W),
    walls: round2(2 * (L + W) * H),
    ceiling: round2(L * W),
  }
}

/**
 * Build (or refresh) the 3-surface array for a room. Quantities always
 * re-derive from the current dimensions so the Assessment stays the source
 * of truth; include flags and unit prices the user has entered are preserved.
 */
export function buildSurfaceLines(
  lengthM: number,
  widthM: number,
  heightM: number,
  prior?: SurfacePricingLine[],
): SurfacePricingLine[] {
  const areas = deriveSurfaceAreas(lengthM, widthM, heightM)
  const priorByKind = new Map<SurfaceKind, SurfacePricingLine>(
    (prior ?? []).map(s => [s.kind, s]),
  )
  return SURFACE_KINDS.map(kind => {
    const p = priorByKind.get(kind)
    const included = p?.included ?? SURFACE_DEFAULT_INCLUDED[kind]
    const rate = Math.max(0, Number(p?.unit_price_per_sqm ?? 0))
    const area = areas[kind]
    return {
      kind,
      included,
      area_m2: area,
      unit_price_per_sqm: rate,
      total: included ? round2(area * rate) : 0,
    }
  })
}

/** Sum of included surface totals for a single area row. */
export function sumIncludedSurfaceTotals(surfaces: SurfacePricingLine[]): number {
  return round2(
    surfaces.reduce(
      (s, x) => s + (x.included ? Math.max(0, Number(x.total) || 0) : 0),
      0,
    ),
  )
}

/**
 * Upgrade a legacy single-rate row (no `surfaces`) into the 3-surface shape
 * without changing its total. The legacy `unit_price_per_sqm` is treated as
 * the floor rate; walls/ceiling start excluded with $0 so the row total stays
 * identical to the pre-upgrade value. Already-upgraded rows just get their
 * surface quantities refreshed against the current dimensions.
 */
export function upgradeLegacyAreaRow(row: AreaPricingRow): AreaPricingRow {
  if (row.surfaces && row.surfaces.length > 0) {
    const surfaces = buildSurfaceLines(row.length_m, row.width_m, row.height_m, row.surfaces)
    return { ...row, surfaces, total: sumIncludedSurfaceTotals(surfaces) }
  }
  const legacyRate = Math.max(0, Number(row.unit_price_per_sqm) || 0)
  const seed: SurfacePricingLine[] = [
    { kind: 'floor',   included: true,  area_m2: 0, unit_price_per_sqm: legacyRate, total: 0 },
    { kind: 'walls',   included: false, area_m2: 0, unit_price_per_sqm: 0,          total: 0 },
    { kind: 'ceiling', included: false, area_m2: 0, unit_price_per_sqm: 0,          total: 0 },
  ]
  const surfaces = buildSurfaceLines(row.length_m, row.width_m, row.height_m, seed)
  return { ...row, surfaces, total: sumIncludedSurfaceTotals(surfaces) }
}

/**
 * Flatten excluded surfaces across all priced rooms into "Surface — Room"
 * strings, suitable for rendering as a bullet list under "Excluded from this quote".
 */
export function collectExcludedSurfaces(rows: AreaPricingRow[]): string[] {
  const out: string[] = []
  for (const row of rows) {
    const list = row.surfaces ?? []
    for (const s of list) {
      if (!s.included) out.push(`${SURFACE_LABELS[s.kind]} — ${row.area_name}`)
    }
  }
  return out
}
