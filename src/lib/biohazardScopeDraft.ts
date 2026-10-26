import {
  BIOHAZARD_CLEANING_SCHEMA,
  BIOHAZARD_COMPLETION_REPORT_LINE,
  BIOHAZARD_PLACEHOLDERS,
  biohazardCleaningDocumentTitle,
  resolvedAreasAffected,
  resolvedBiohazardKind,
  resolvedBiohazardTypes,
  resolvedObjective,
  resolvedOtherZones,
  resolvedSecondaryContaminations,
  secondaryZoneInUse,
  type BiohazardCleaningCapture,
  type BiohazardCleaningClauses,
} from '@/lib/biohazardCleaningQuote'
import {
  BIOHAZARD_NAMED_METHOD,
  BIOHAZARD_PASS_CRITERIA,
  BIOHAZARD_STAGES,
  BIOHAZARD_VAGUE_METHOD,
  type BiohazardAuditGap,
  type BiohazardCheckContext,
} from '@/lib/biohazardCleaningCheck'

/** Lines about the COH and testing are added by code when they are ticked, so a draft never carries them. */
const SERVICE_LINE = /occupational hygien|remediation action plan|\bRAP\b|\bCOH\b|\bATP\b|laborator|completion report|records of the works|records for the hygienist|written instructions/i

const MAX_LINES = 16
const MAX_LINE_LENGTH = 450
const MIN_PART = 3

export const BIOHAZARD_DRAFT_STAGES = [...BIOHAZARD_STAGES.map(stage => stage.id), 'secondary'] as const

/** A drafted step that does not say one of the things a hygienist audits. */
export interface BiohazardDraftWeakStep {
  line: string
  gap: BiohazardAuditGap
}

export interface BiohazardScopeDraft {
  scope: string
  weak: BiohazardDraftWeakStep[]
}

/** What the model reads to draft the scope of work. */
export function biohazardScopeDraftPayload(
  capture: BiohazardCleaningCapture,
  context: BiohazardCheckContext,
  template?: BiohazardCleaningClauses | null,
) {
  const secondary = secondaryZoneInUse(capture)
  const names = (rooms: BiohazardCleaningCapture['rooms']) => rooms.map(room => room.name.trim()).filter(Boolean)
  return {
    details: {
      client_title: biohazardCleaningDocumentTitle(resolvedBiohazardKind(capture, context.defaults.jobType)),
      biohazard_types: resolvedBiohazardTypes(capture, context.defaults),
      primary_zone_areas: resolvedAreasAffected(capture, context.defaults),
      primary_zone_rooms: names(capture.rooms),
      primary_zone_m2: capture.estimated_m2,
      description: capture.description.trim(),
      objective: resolvedObjective(capture, context.defaults),
      secondary_zone_in_use: secondary,
      secondary_zone: secondary ? (capture.secondary_zone ?? '').trim() : '',
      secondary_zone_rooms: secondary ? names(capture.secondary_rooms) : [],
      secondary_contaminations: secondary ? resolvedSecondaryContaminations(capture) : [],
      secondary_objective: secondary ? (capture.secondary_objective ?? '').trim() : '',
      other_zones: resolvedOtherZones(capture),
    },
    assessment: {
      areas: context.areaNames,
      presenting_health_hazards: context.hazards,
      risks: context.risks,
    },
    standard_stages: BIOHAZARD_STAGES.map(stage => stage.label),
    house_scope: (template?.scope_of_work ?? BIOHAZARD_CLEANING_SCHEMA.scope_of_work.join('\n'))
      .split('\n')
      .filter(line => line.trim() && !SERVICE_LINE.test(line)),
    placeholders: BIOHAZARD_PLACEHOLDERS.filter(name =>
      name !== 'primary zone'
      && (secondary || !name.startsWith('secondary'))
      && (resolvedOtherZones(capture).length > 0 || (name !== 'other zones' && name !== 'unaffected areas'))
    ),
  }
}

/** Each step carries the words in it that say where, what, how, and for verification, the pass. */
export function biohazardScopeDraftSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            stage: { type: 'string', enum: [...BIOHAZARD_DRAFT_STAGES] },
            text: { type: 'string' },
            where: { type: 'string' },
            what: { type: 'string' },
            how: { type: 'string' },
            pass: { type: 'string' },
          },
          required: ['stage', 'text', 'where', 'what', 'how', 'pass'],
        },
      },
    },
    required: ['steps'],
  } as const
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function cleanLine(raw: string, known: Set<string>): string {
  return raw
    .replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '')
    .replace(/\[([^\[\]\n]+)\]/g, (match, name: string) => known.has(name.trim().toLowerCase()) ? match : name)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Keep the model's steps as plain scope lines: COH or testing lines are removed, unknown brackets are unwrapped,
 * and the completion report is last. A step whose where, what, how, or pass words are blank or not in the step
 * is listed as weak. Null when there is too little to use.
 */
export function acceptBiohazardScopeDraft(parsed: unknown, secondaryInUse: boolean): BiohazardScopeDraft | null {
  const raw = parsed && typeof parsed === 'object' ? (parsed as { steps?: unknown }).steps : null
  if (!Array.isArray(raw)) return null
  const known = new Set<string>(BIOHAZARD_PLACEHOLDERS)
  const lines: string[] = []
  const weak: BiohazardDraftWeakStep[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const step = item as Record<string, unknown>
    const text = typeof step.text === 'string' ? cleanLine(step.text, known) : ''
    if (!text || text.length > MAX_LINE_LENGTH || SERVICE_LINE.test(text)) continue
    if (!secondaryInUse && (step.stage === 'secondary' || /\[secondary /i.test(text))) continue
    if (lines.includes(text) || lines.length >= MAX_LINES) continue
    lines.push(text)
    const partOf = (key: string) => (typeof step[key] === 'string' ? cleanLine(step[key] as string, known) : '')
    const says = (key: string) => {
      const part = partOf(key)
      return part.length >= MIN_PART && normalize(text).includes(normalize(part))
    }
    const how = partOf('how')
    const howIsVague = BIOHAZARD_VAGUE_METHOD.test(how || text) && !BIOHAZARD_NAMED_METHOD.test(how || text)
    const gaps: BiohazardAuditGap[] = ['where', 'what', 'how']
    if (step.stage === 'verification' && !BIOHAZARD_PASS_CRITERIA.test(text)) gaps.push('pass')
    const gap = gaps.find(key => key === 'how' ? !says('how') || howIsVague : !says(key))
    if (gap) weak.push({ line: text, gap })
  }
  if (lines.length < 3) return null
  return { scope: [...lines, BIOHAZARD_COMPLETION_REPORT_LINE].join('\n'), weak }
}
