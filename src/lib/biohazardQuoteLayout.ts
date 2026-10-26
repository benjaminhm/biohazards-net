import {
  joinBiohazardNames,
  resolvedAreasAffected,
  resolvedBiohazardType,
  resolvedObjective,
  resolvedSecondaryContamination,
  resolvedSecondaryContaminations,
  secondaryZoneInUse,
  type BiohazardCleaningCapture,
  type BiohazardCleaningFigures,
  type BiohazardJobDefaults,
} from '@/lib/biohazardCleaningQuote'
import { roomSurfaceArea, type SurfaceAreaRoom } from '@/lib/surfaceAreaCleaningQuote'

export type BiohazardClientKind = 'estate' | 'agent' | 'owner'

export interface BiohazardMeasuredRoom {
  name: string
  length_m: number
  width_m: number
  height_m: number
  area_m2: number
}

export interface BiohazardZoneView {
  key: 'primary' | 'secondary'
  title: string
  rooms: string[]
  rooms_label: string
  contaminant: string
  objective: string
  m2: number
  rate_per_m2: number
  amount: number
}

export interface BiohazardZoneMismatch {
  room: string
  zone: 'primary' | 'secondary'
  issue: 'listed_not_measured' | 'measured_not_listed'
}

export const BIOHAZARD_SCOPE_PHASES = [
  { id: 'setup', title: '1. Site setup and PPE', test: /contain|isolat|barrier|ppe|respirat|coverall|decontamination point/i },
  { id: 'primary', title: '2. Primary zone — decontamination', test: /primary zone|\[area affected\]|\[primary zone\]/i },
  { id: 'secondary', title: '3. Secondary zone — odour and insects', test: /secondary zone|\[secondary/i },
  { id: 'waste', title: '4. Waste transport and disposal', test: /clinical waste|dispos|transport and dispose/i },
  { id: 'clearance', title: '5. Clearance testing', test: /hold point|clearance|ATP|laborator|verif/i },
  { id: 'records', title: '6. Completion records', test: /completion report|records of the works|records for the hygienist/i },
] as const

const TYPOS: [RegExp, string][] = [
  [/\bfuild\b/gi, 'fluid'],
  [/\bnon-strucutral\b/gi, 'non-structural'],
  [/\bstrucutral\b/gi, 'structural'],
  [/\bwarddrobe\b/gi, 'wardrobe'],
  [/\bflys\b/gi, 'flies'],
  [/\bassumes to have be\b/gi, 'assumed to have been'],
  [/\bhydroxyl\/ozon2\b/gi, 'hydroxyl/ozone'],
]

export function tidyBiohazardPrintText(text: string): string {
  let next = (text ?? '').replace(/[ \t]+/g, ' ').replace(/[,\s]+$/g, '').trim()
  for (const [pattern, replacement] of TYPOS) next = next.replace(pattern, replacement)
  if (/to enable structural$/i.test(next)) next = `${next} repairs.`
  return next
}

export function tidyBiohazardAddress(address: string): string {
  return (address ?? '').replace(/[ \t]+/g, ' ').replace(/[,\s]+$/g, '').trim()
}

export function parseNamedList(text: string): string[] {
  return [...new Set(
    (text ?? '')
      .split(/,|\band\b/i)
      .map(part => tidyBiohazardPrintText(part.replace(/[.]+$/g, '')))
      .filter(Boolean),
  )]
}

export function roomMatchKey(name: string): string {
  return tidyBiohazardPrintText(name)
    .toLowerCase()
    .replace(/walk-?in\s+wardrobe/g, 'wardrobe')
    .replace(/\bmain bedroom\b/g, 'master bedroom')
    .replace(/\bliving room\b/g, 'living')
    .replace(/\bhallway\b/g, 'hall')
    .replace(/\bstaircase\b/g, 'stairs')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function measuredRooms(rooms: SurfaceAreaRoom[]): BiohazardMeasuredRoom[] {
  return rooms.flatMap(room => {
    const measure = roomSurfaceArea(room)
    if (!measure) return []
    return [{
      name: tidyBiohazardPrintText(room.name.trim() || 'Room'),
      length_m: room.length_m as number,
      width_m: room.width_m as number,
      height_m: room.height_m as number,
      area_m2: measure.total,
    }]
  })
}

function mismatches(
  zone: 'primary' | 'secondary',
  listed: string[],
  measured: BiohazardMeasuredRoom[],
): BiohazardZoneMismatch[] {
  if (listed.length === 0 || measured.length === 0) return []
  const listedKeys = new Set(listed.map(roomMatchKey))
  const measuredKeys = new Set(measured.map(room => roomMatchKey(room.name)))
  const flags: BiohazardZoneMismatch[] = []
  for (const name of listed) {
    if (!measuredKeys.has(roomMatchKey(name))) flags.push({ room: name, zone, issue: 'listed_not_measured' })
  }
  for (const room of measured) {
    if (!listedKeys.has(roomMatchKey(room.name))) flags.push({ room: room.name, zone, issue: 'measured_not_listed' })
  }
  return flags
}

export function biohazardClientKind(input: {
  clientName?: string | null
  contactRole?: string | null
  organization?: string | null
}): BiohazardClientKind {
  const blob = [input.clientName, input.contactRole, input.organization].join(' ').toLowerCase()
  if (/\b(estate|executor|administrator|probate|deceased)\b/.test(blob)) return 'estate'
  if (/\b(property manager|agent|agency|real estate)\b/.test(blob)) return 'agent'
  return 'owner'
}

export function formatBcqClientLine(input: {
  clientName?: string | null
  contactRole?: string | null
  organization?: string | null
}): string {
  const raw = (input.clientName ?? '').trim()
  const fromName = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  const name = (fromName?.[1] ?? raw).trim()
  const role = (input.contactRole ?? '').trim() || (fromName?.[2] ?? '').trim()
  const org = (input.organization ?? '').trim()
  return [name, role, org].filter(Boolean).join(', ') || '—'
}

export function quoteValidUntil(from = new Date()): string {
  const date = new Date(from)
  date.setDate(date.getDate() + 30)
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function biohazardQuoteZones(
  capture: BiohazardCleaningCapture,
  figures: BiohazardCleaningFigures,
  defaults: BiohazardJobDefaults = {},
): { primary: BiohazardZoneView; secondary: BiohazardZoneView | null; mismatches: BiohazardZoneMismatch[] } {
  const primaryMeasured = measuredRooms(capture.rooms ?? [])
  const listedPrimary = resolvedAreasAffected(capture, defaults)
  const primaryRooms = primaryMeasured.length > 0 ? primaryMeasured.map(room => room.name) : listedPrimary
  const primary: BiohazardZoneView = {
    key: 'primary',
    title: 'Primary decontamination zone',
    rooms: primaryRooms,
    rooms_label: joinBiohazardNames(primaryRooms),
    contaminant: resolvedBiohazardType(capture, defaults),
    objective: tidyBiohazardPrintText(resolvedObjective(capture, defaults)),
    m2: figures.estimated_m2,
    rate_per_m2: figures.rate_per_m2,
    amount: figures.area_amount,
  }
  const flags = mismatches('primary', listedPrimary, primaryMeasured)
  if (!figures.has_secondary && !secondaryZoneInUse(capture)) {
    return { primary, secondary: null, mismatches: flags }
  }
  const secondaryMeasured = measuredRooms(capture.secondary_rooms ?? [])
  const listedSecondary = parseNamedList(capture.secondary_zone ?? '')
  const secondaryRooms = secondaryMeasured.length > 0 ? secondaryMeasured.map(room => room.name) : listedSecondary
  const secondary: BiohazardZoneView = {
    key: 'secondary',
    title: 'Secondary zone — odour and insects',
    rooms: secondaryRooms,
    rooms_label: joinBiohazardNames(secondaryRooms),
    contaminant: resolvedSecondaryContamination(capture) || joinBiohazardNames(resolvedSecondaryContaminations(capture)),
    objective: tidyBiohazardPrintText(capture.secondary_objective ?? ''),
    m2: figures.secondary_m2,
    rate_per_m2: figures.secondary_rate_per_m2,
    amount: figures.secondary_amount,
  }
  return {
    primary,
    secondary,
    mismatches: [...flags, ...mismatches('secondary', listedSecondary, secondaryMeasured)],
  }
}

export function measuredRoomsForZone(rooms: SurfaceAreaRoom[]): BiohazardMeasuredRoom[] {
  return measuredRooms(rooms)
}

/** Drop a second encapsulant step in the primary zone; keep the one after deodorising. */
export function withoutDuplicateEncapsulant(lines: string[]): string[] {
  const encapsulant = lines
    .map((line, index) => ({ line, index }))
    .filter(item => /encapsul/i.test(item.line) && !/secondary zone/i.test(item.line))
  if (encapsulant.length < 2) return lines
  const keep = [...encapsulant].reverse().find(item => /deodori/i.test(item.line)) ?? encapsulant[encapsulant.length - 1]
  const drop = new Set(encapsulant.filter(item => item.index !== keep.index).map(item => item.index))
  return lines.filter((_, index) => !drop.has(index))
}

export function groupBiohazardScope(lines: string[]): { title: string; steps: string[] }[] {
  const cleaned = withoutDuplicateEncapsulant(lines.map(line => tidyBiohazardPrintText(line)).filter(Boolean))
  const groups: { title: string; steps: string[] }[] = BIOHAZARD_SCOPE_PHASES.map(phase => ({ title: phase.title, steps: [] }))
  const leftover: string[] = []
  for (const line of cleaned) {
    const index = BIOHAZARD_SCOPE_PHASES.findIndex((phase, order) => {
      if (phase.id === 'primary' && /secondary zone/i.test(line)) return false
      if (phase.id === 'clearance' && /visual inspection/i.test(line) && !/ATP|laborator|hold point|clearance/i.test(line)) return false
      if (phase.id === 'setup' && /secondary zone/i.test(line)) return false
      if (phase.id === 'waste' && /completion report|records of the works|records for the hygienist/i.test(line)) return false
      return phase.test.test(line) && (order !== 1 || !BIOHAZARD_SCOPE_PHASES[2].test.test(line))
    })
    if (index === -1) leftover.push(line)
    else groups[index].steps.push(line)
  }
  if (leftover.length > 0) {
    const primary = groups.find(group => group.title.startsWith('2.'))
    if (primary) primary.steps.push(...leftover)
    else groups.push({ title: 'Works', steps: leftover })
  }
  return groups.filter(group => group.steps.length > 0)
}

export function withBothZonePrintClauses(
  inclusions: string[],
  assumptions: string[],
  input: {
    has_secondary: boolean
    mobilisation_fee: number
    extra_labels?: string[]
  },
): { inclusions: string[]; assumptions: string[] } {
  const nextInclusions = [...inclusions]
  const nextAssumptions = [...assumptions]
  if (input.has_secondary) {
    if (!nextInclusions.some(line => /secondary zone/i.test(line))) {
      nextInclusions.push('Odour and insect treatment of the secondary zone, at the rate per square metre on this quote.')
    }
    if (!nextAssumptions.some(line => /secondary/i.test(line) && /square metre|m²|m2/i.test(line))) {
      nextAssumptions.push('Secondary zone square metres on this quote are an estimate. An accurate onsite measurement survey revises them, at the secondary zone rate per square metre on this quote.')
    }
  }
  if ((input.extra_labels ?? []).some(label => /ATP|laborator/i.test(label)) && !nextInclusions.some(line => /ATP|laborator|testing/i.test(line))) {
    nextInclusions.push('Clearance testing listed on this quote.')
  }
  if (input.mobilisation_fee > 0 && !nextInclusions.some(line => /mobili[sz]ation|call-?out/i.test(line))) {
    nextInclusions.push('Mobilisation as the fee on this quote.')
  }
  return { inclusions: nextInclusions, assumptions: nextAssumptions }
}

export function depositFromTotal(total: number): { deposit: number; balance: number } {
  if (!Number.isFinite(total) || total <= 0) return { deposit: 0, balance: 0 }
  const deposit = Math.round(total * 50) / 100
  return { deposit, balance: Math.round((total - deposit) * 100) / 100 }
}

function money(n: number): string {
  return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function secondarySurfaceSentence(figures: BiohazardCleaningFigures): string {
  if (!figures.has_secondary) return ''
  return `Estimated secondary surface: ${figures.secondary_m2.toLocaleString('en-AU', { maximumFractionDigits: 2 })} m² at ${money(figures.secondary_rate_per_m2)} ex GST = ${money(figures.secondary_amount)}.`
}

export function renumberEngagementClauses(text: string): string {
  const sections = new Map<string, number>()
  return text.replace(/^(\d+)\.(\d+)/gm, (_, section: string) => {
    const next = (sections.get(section) ?? 0) + 1
    sections.set(section, next)
    return `${section}.${next}`
  })
}

export function adaptBiohazardEngagement(
  text: string,
  kind: BiohazardClientKind,
  figures: Pick<BiohazardCleaningFigures, 'has_secondary' | 'secondary_m2' | 'secondary_rate_per_m2' | 'secondary_amount'>,
): string {
  let next = text
  const secondary = secondarySurfaceSentence(figures)
  if (secondary && !/secondary surface|secondary zone/i.test(next)) {
    next = next.replace(
      /(Surface cleaning is estimated at[^\n]*\.)/,
      `$1\n${secondary}`,
    )
    if (!next.includes(secondary)) {
      next = next.replace(/(Estimated surface:[^\n]*)/, `$1\n${secondary}`)
    }
  }
  if (kind !== 'estate') {
    next = next
      .replace(/^1\.2 Executor or administrator\.[^\n]*\n/m, '')
      .replace(/^1\.3 Signing personally\.[^\n]*\n/m, '')
      .replace(/^2\.2 Before the works start[^\n]*\n/m, '')
      .replace(/^Areas to be cleared:.*\n/m, '')
      .replace(/^Items to be retained:.*\n/m, '')
      .replace(/, or, for an estate, the estate care of the Signatory/g, '')
      .replace(/Signing capacity \(tick one\):[\s\S]*?(?=Signatory:|$)/, kind === 'agent'
        ? 'Signing capacity (tick one):\n☐ Agent for owner (authority held)\n☐ Owner\n\n'
        : 'Signing capacity (tick one):\n☐ Owner\n\n')
  }
  return renumberEngagementClauses(next).replace(/\n{3,}/g, '\n\n').trim()
}
