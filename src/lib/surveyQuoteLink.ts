/**
 * Surface Area Cleaning Quote → House Survey.
 * The quote sets the rate and the estimated rooms. The survey is the measured area.
 */

import type { AssessmentData } from '@/lib/types'
import {
  areaSurfaces,
  newHouseSurveyAdjustment,
  newHouseSurveyArea,
  normalizeHouseSurvey,
  rectangularSurveyLegs,
  pricedSurfaces,
  traceHouseSurvey,
  type HouseSurveyArea,
  type HouseSurveyCapture,
} from '@/lib/houseSurvey'
import {
  normalizeSurfaceAreaCleaningCapture,
  pricedRoomSurface,
  quotedSquareMetres,
  roomSurfaceArea,
  type SurfaceAreaRoom,
} from '@/lib/surfaceAreaCleaningQuote'

export interface QuoteSurveyRoom {
  name: string
  length_m: number
  width_m: number
  height_m: number
  quoted_m2: number
}

export interface QuoteSurveyLink {
  /** Ex GST rate per square metre on the quote. Null when the quote has no rate. */
  rate_per_m2: number | null
  /** Square metres on the quote, from the rooms or the typed total. */
  quoted_m2: number | null
  exclude_ceiling: boolean
  /** Rooms with all three dimensions. */
  rooms: QuoteSurveyRoom[]
}

export function quoteSurveyLink(ad: AssessmentData | null | undefined): QuoteSurveyLink | null {
  if (!ad?.surface_area_cleaning_quote) return null
  const quote = normalizeSurfaceAreaCleaningCapture(ad.surface_area_cleaning_quote)
  const rate = quote.rate_per_m2 != null && quote.rate_per_m2 > 0 ? quote.rate_per_m2 : null
  const quoted = quotedSquareMetres(quote)
  const rooms = (quote.rooms ?? []).flatMap((room: SurfaceAreaRoom, index): QuoteSurveyRoom[] => {
    const measure = pricedRoomSurface(room, quote.exclude_ceiling)
    if (!measure || room.length_m == null || room.width_m == null || room.height_m == null) return []
    return [{
      name: room.name.trim() || `Room ${index + 1}`,
      length_m: room.length_m,
      width_m: room.width_m,
      height_m: room.height_m,
      quoted_m2: measure.total,
    }]
  })
  if (rate == null && (quoted == null || quoted <= 0) && rooms.length === 0) return null
  return {
    rate_per_m2: rate,
    quoted_m2: quoted != null && quoted > 0 ? quoted : null,
    exclude_ceiling: quote.exclude_ceiling,
    rooms,
  }
}

/** A blank survey rate follows the quote. A typed rate stays. */
export function effectiveSurveyRate(survey: Pick<HouseSurveyCapture, 'price_per_m2'>, link: QuoteSurveyLink | null): number | null {
  return survey.price_per_m2 ?? link?.rate_per_m2 ?? null
}

/** Survey as stored, with a blank rate taken from the quote. For documents and the statement. */
export function houseSurveyWithQuote(ad: AssessmentData | null | undefined): HouseSurveyCapture {
  const survey = normalizeHouseSurvey(ad?.house_survey)
  return { ...survey, price_per_m2: effectiveSurveyRate(survey, quoteSurveyLink(ad)) }
}

/** One rectangle per quoted room, walked clockwise. The ceiling is excluded when the quote left it out. */
export function surveyAreasFromQuoteRooms(link: QuoteSurveyLink): HouseSurveyArea[] {
  return link.rooms.map(room => {
    const legs = rectangularSurveyLegs(room.length_m, room.width_m)
    const ceiling = roomSurfaceArea(room)?.ceiling ?? null
    const adjustments = link.exclude_ceiling && ceiling != null
      ? [{
          ...newHouseSurveyAdjustment(),
          length_m: room.length_m,
          width_m: room.width_m,
          area_m2: ceiling,
          surface: 'ceiling' as const,
          description: 'Ceiling excluded on the quote',
        }]
      : []
    return {
      ...newHouseSurveyArea(),
      title: room.name,
      description: 'From the quote. Measure and correct each wall.',
      height_m: room.height_m,
      legs,
      adjustments,
    }
  })
}

/** Nothing measured yet: no area has a wall length. */
export function surveyIsBlank(survey: HouseSurveyCapture): boolean {
  return survey.areas.every(area => !area.title.trim() && area.legs.every(leg => leg.length_m == null))
}

export interface QuotedMeasuredRow {
  label: string
  quoted_m2: number | null
  measured_m2: number | null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function key(label: string): string {
  return label.trim().toLowerCase()
}

/** Quoted square metres beside measured, matched by room title. Rows keep quote order, then survey-only rooms. */
export function quotedVersusMeasured(
  survey: HouseSurveyCapture,
  link: QuoteSurveyLink | null,
): { rows: QuotedMeasuredRow[]; quoted_m2: number | null; measured_m2: number | null } {
  const rows: QuotedMeasuredRow[] = []
  const byKey = new Map<string, QuotedMeasuredRow>()
  const row = (label: string): QuotedMeasuredRow => {
    const existing = byKey.get(key(label))
    if (existing) return existing
    const next: QuotedMeasuredRow = { label: label.trim(), quoted_m2: null, measured_m2: null }
    byKey.set(key(label), next)
    rows.push(next)
    return next
  }
  for (const room of link?.rooms ?? []) {
    const r = row(room.name)
    r.quoted_m2 = round2((r.quoted_m2 ?? 0) + room.quoted_m2)
  }
  let measuredAny = false
  let measuredSum = 0
  survey.areas.forEach((area, index) => {
    const priced = pricedSurfaces(areaSurfaces(traceHouseSurvey(area.legs), area.height_m), area.adjustments).priced
    if (priced == null) return
    measuredAny = true
    measuredSum += priced
    const r = row(area.title.trim() || `Area ${index + 1}`)
    r.measured_m2 = round2((r.measured_m2 ?? 0) + priced)
  })
  return {
    rows,
    quoted_m2: link?.quoted_m2 ?? null,
    measured_m2: measuredAny ? round2(measuredSum) : null,
  }
}
