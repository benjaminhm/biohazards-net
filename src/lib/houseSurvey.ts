export type HouseSurveyTurn = 'left' | 'right'

export interface HouseSurveyLeg {
  id: string
  turn: HouseSurveyTurn
  length_m: number | null
}

export interface HouseSurveyCapture {
  start_note: string
  legs: HouseSurveyLeg[]
}

export interface SurveyPoint {
  x: number
  y: number
}

export interface HouseSurveyTrace {
  points: SurveyPoint[]
  perimeter: number
  gap: number
  closed: boolean
  area: number
}

const CLOSE_GAP_M = 0.15

export function emptyHouseSurvey(): HouseSurveyCapture {
  return { start_note: '', legs: [] }
}

export function newHouseSurveyLeg(turn: HouseSurveyTurn = 'right'): HouseSurveyLeg {
  return {
    id: `wall_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    turn,
    length_m: null,
  }
}

export function normalizeHouseSurvey(raw: unknown): HouseSurveyCapture {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const legs = Array.isArray(o.legs) ? o.legs : []
  return {
    start_note: typeof o.start_note === 'string' ? o.start_note : '',
    legs: legs.map(leg => {
      const row = leg && typeof leg === 'object' ? leg as Record<string, unknown> : {}
      const length = typeof row.length_m === 'number' ? row.length_m : Number(row.length_m)
      return {
        id: typeof row.id === 'string' && row.id ? row.id : newHouseSurveyLeg().id,
        turn: row.turn === 'left' ? 'left' : 'right',
        length_m: Number.isFinite(length) && length >= 0 ? length : null,
      }
    }),
  }
}

/** Clockwise interior walk. Right is a 90° clockwise turn, left is 90° the other way. */
export function traceHouseSurvey(legs: HouseSurveyLeg[]): HouseSurveyTrace {
  let x = 0
  let y = 0
  let heading = 0
  const points: SurveyPoint[] = [{ x: 0, y: 0 }]
  let perimeter = 0
  for (const leg of legs) {
    const length = leg.length_m
    if (length == null || !Number.isFinite(length) || length <= 0) continue
    heading += leg.turn === 'left' ? 90 : -90
    const rad = (heading * Math.PI) / 180
    x += length * Math.cos(rad)
    y += length * Math.sin(rad)
    points.push({ x, y })
    perimeter += length
  }
  const gap = Math.hypot(x, y)
  let area = 0
  for (let i = 0; i < points.length - 1; i++) {
    area += points[i].x * points[i + 1].y - points[i + 1].x * points[i].y
  }
  area = Math.abs(area) / 2
  return {
    points,
    perimeter: Math.round(perimeter * 100) / 100,
    gap: Math.round(gap * 100) / 100,
    closed: points.length > 2 && gap <= CLOSE_GAP_M,
    area: Math.round(area * 100) / 100,
  }
}

export function surveySketchPath(points: SurveyPoint[]): { d: string; width: number; height: number } | null {
  if (points.length < 2) return null
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const pad = 8
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const width = 320
  const height = 220
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY)
  const xy = (p: SurveyPoint) => {
    const sx = pad + (p.x - minX) * scale
    const sy = height - pad - (p.y - minY) * scale
    return `${sx.toFixed(1)},${sy.toFixed(1)}`
  }
  return { d: points.map(xy).join(' '), width, height }
}
