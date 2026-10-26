import {
  BIOHAZARD_CLEANING_SCHEMA,
  BIOHAZARD_COMPLETION_REPORT_LINE,
  BIOHAZARD_PLACEHOLDERS,
  biohazardCleaningDocumentTitle,
  resolvedAreasAffected,
  resolvedBiohazardKind,
  resolvedBiohazardTypes,
  resolvedObjective,
  resolvedSecondaryContaminations,
  secondaryZoneInUse,
  type BiohazardCleaningCapture,
  type BiohazardCleaningClauses,
} from '@/lib/biohazardCleaningQuote'
import { BIOHAZARD_STAGES, type BiohazardCheckContext } from '@/lib/biohazardCleaningCheck'

/** Lines about the COH and testing are added by code when they are ticked, so a draft never carries them. */
const SERVICE_LINE = /occupational hygien|remediation action plan|\bRAP\b|\bCOH\b|\bATP\b|laborator|completion report/i

const MAX_LINES = 16
const MAX_LINE_LENGTH = 400

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
    placeholders: BIOHAZARD_PLACEHOLDERS.filter(name => name !== 'primary zone' && (secondary || !name.startsWith('secondary'))),
  }
}

export function biohazardScopeDraftSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      lines: { type: 'array', items: { type: 'string' } },
    },
    required: ['lines'],
  } as const
}

/**
 * Keep the model's lines as plain scope lines: numbering, blank lines, and COH or testing lines are removed,
 * unknown brackets are unwrapped, and the completion report is last. Null when there is too little to use.
 */
export function acceptBiohazardScopeDraft(parsed: unknown, secondaryInUse: boolean): string | null {
  const raw = parsed && typeof parsed === 'object' ? (parsed as { lines?: unknown }).lines : null
  if (!Array.isArray(raw)) return null
  const known = new Set<string>(BIOHAZARD_PLACEHOLDERS)
  const lines = raw
    .filter((line): line is string => typeof line === 'string')
    .map(line => line
      .replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '')
      .replace(/\[([^\[\]\n]+)\]/g, (match, name: string) => known.has(name.trim().toLowerCase()) ? match : name)
      .replace(/\s+/g, ' ')
      .trim())
    .filter(line => line && line.length <= MAX_LINE_LENGTH && !SERVICE_LINE.test(line))
    .filter(line => secondaryInUse || !/\[secondary /i.test(line))
  const unique = [...new Set(lines)].slice(0, MAX_LINES)
  if (unique.length < 3) return null
  return [...unique, BIOHAZARD_COMPLETION_REPORT_LINE].join('\n')
}
