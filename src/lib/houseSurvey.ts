export type HouseSurveyTurn = 'left' | 'right'

export interface HouseSurveyLeg {
  id: string
  turn: HouseSurveyTurn
  length_m: number | null
}

export interface HouseSurveyArea {
  id: string
  title: string
  description: string
  start_note: string
  height_m: number | null
  legs: HouseSurveyLeg[]
}

export interface HouseSurveyCapture {
  areas: HouseSurveyArea[]
}

export interface SurveyPoint {
  x: number
  y: number
}

export interface SurveySegment {
  legId: string
  from: SurveyPoint
  to: SurveyPoint
}

export interface HouseSurveyTrace {
  points: SurveyPoint[]
  segments: SurveySegment[]
  perimeter: number
  gap: number
  closed: boolean
  area: number
}

const CLOSE_GAP_M = 0.15

export function newHouseSurveyArea(): HouseSurveyArea {
  return {
    id: `area_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    description: '',
    start_note: '',
    height_m: null,
    legs: [],
  }
}

export function emptyHouseSurvey(): HouseSurveyCapture {
  return { areas: [newHouseSurveyArea()] }
}

export function newHouseSurveyLeg(turn: HouseSurveyTurn = 'right'): HouseSurveyLeg {
  return {
    id: `wall_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    turn,
    length_m: null,
  }
}

function normalizeLeg(raw: unknown): HouseSurveyLeg {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const length = typeof row.length_m === 'number' ? row.length_m : Number(row.length_m)
  return {
    id: typeof row.id === 'string' && row.id ? row.id : newHouseSurveyLeg().id,
    turn: row.turn === 'left' ? 'left' : 'right',
    length_m: Number.isFinite(length) && length >= 0 ? length : null,
  }
}

function normalizeArea(raw: unknown): HouseSurveyArea {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const legs = Array.isArray(row.legs) ? row.legs : []
  return {
    id: typeof row.id === 'string' && row.id ? row.id : newHouseSurveyArea().id,
    title: typeof row.title === 'string' ? row.title : '',
    description: typeof row.description === 'string' ? row.description : '',
    start_note: typeof row.start_note === 'string' ? row.start_note : '',
    height_m: typeof row.height_m === 'number' && Number.isFinite(row.height_m) && row.height_m >= 0 ? row.height_m : null,
    legs: legs.map(normalizeLeg),
  }
}

export function normalizeHouseSurvey(raw: unknown): HouseSurveyCapture {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  if (Array.isArray(o.areas)) {
    const areas = o.areas.map(normalizeArea)
    return { areas: areas.length > 0 ? areas : [newHouseSurveyArea()] }
  }
  return {
    areas: [normalizeArea({
      id: 'area_1',
      title: '',
      description: '',
      start_note: o.start_note,
      legs: o.legs,
    })],
  }
}

export function areaSurfaces(trace: HouseSurveyTrace, heightM: number | null): {
  floor: number | null
  ceiling: number | null
  walls: number | null
  all: number | null
} {
  const floor = trace.closed ? trace.area : null
  const height = heightM != null && Number.isFinite(heightM) && heightM > 0 ? heightM : null
  const walls = height == null || trace.perimeter <= 0 ? null : Math.round(trace.perimeter * height * 100) / 100
  const parts = [floor, floor, walls].filter((value): value is number => value != null)
  return {
    floor,
    ceiling: floor,
    walls,
    all: parts.length === 0 ? null : Math.round(parts.reduce((sum, value) => sum + value, 0) * 100) / 100,
  }
}
export function traceHouseSurvey(legs: HouseSurveyLeg[]): HouseSurveyTrace {
  let x = 0
  let y = 0
  let heading = 0
  const points: SurveyPoint[] = [{ x: 0, y: 0 }]
  const segments: SurveySegment[] = []
  let perimeter = 0
  for (const leg of legs) {
    const length = leg.length_m
    if (length == null || !Number.isFinite(length) || length <= 0) continue
    heading += leg.turn === 'left' ? 90 : -90
    const rad = (heading * Math.PI) / 180
    const from = { x, y }
    x += length * Math.cos(rad)
    y += length * Math.sin(rad)
    points.push({ x, y })
    segments.push({ legId: leg.id, from, to: { x, y } })
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
    segments,
    perimeter: Math.round(perimeter * 100) / 100,
    gap: Math.round(gap * 100) / 100,
    closed: points.length > 2 && gap <= CLOSE_GAP_M,
    area: Math.round(area * 100) / 100,
  }
}

export interface SurveySketch {
  width: number
  height: number
  pad: number
  minX: number
  minY: number
  scale: number
  start: { x: number; y: number }
  lines: { legId: string; x1: number; y1: number; x2: number; y2: number }[]
}

export function surveySketchPath(trace: HouseSurveyTrace): SurveySketch | null {
  if (trace.segments.length === 0) return null
  const points = trace.points
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
  const project = (p: SurveyPoint) => ({
    x: pad + (p.x - minX) * scale,
    y: height - pad - (p.y - minY) * scale,
  })
  const start = project(points[0])
  return {
    width,
    height,
    pad,
    minX,
    minY,
    scale,
    start,
    lines: trace.segments.map(segment => {
      const from = project(segment.from)
      const to = project(segment.to)
      return { legId: segment.legId, x1: from.x, y1: from.y, x2: to.x, y2: to.y }
    }),
  }
}

export function metresToSketch(sketch: SurveySketch, point: SurveyPoint): { x: number; y: number } {
  return {
    x: sketch.pad + (point.x - sketch.minX) * sketch.scale,
    y: sketch.height - sketch.pad - (point.y - sketch.minY) * sketch.scale,
  }
}

export function sketchToMetres(sketch: SurveySketch, x: number, y: number): SurveyPoint {
  return {
    x: sketch.minX + (x - sketch.pad) / sketch.scale,
    y: sketch.minY + (sketch.height - sketch.pad - y) / sketch.scale,
  }
}

function nearestOnSegment(a: SurveyPoint, b: SurveyPoint, point: SurveyPoint): SurveyPoint {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { x: a.x, y: a.y }
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2))
  return { x: a.x + t * dx, y: a.y + t * dy }
}

/** Closest spot on the walls to a click, in metres. */
export function nearestPointOnSurvey(trace: HouseSurveyTrace, point: SurveyPoint): SurveyPoint | null {
  let best: SurveyPoint | null = null
  let bestDistance = Infinity
  for (const segment of trace.segments) {
    const snapped = nearestOnSegment(segment.from, segment.to, point)
    const distance = Math.hypot(snapped.x - point.x, snapped.y - point.y)
    if (distance < bestDistance) {
      bestDistance = distance
      best = snapped
    }
  }
  return best
}

export function surveyPointDistance(a: SurveyPoint, b: SurveyPoint): number {
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y) * 100) / 100
}
