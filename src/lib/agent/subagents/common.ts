/*
 * lib/agent/subagents/common.ts
 *
 * Helpers the document definitions share: the compose options the job doc
 * page passes (org catalogues, quote clauses), and plain refusal texts.
 */
import { composeDocumentContent, type ComposeDocumentOptions } from '@/lib/composeDocument'
import { normalizeContentsClearanceStandards } from '@/lib/contentsClearanceQuote'
import { normalizeSurfaceAreaCleaningStandards } from '@/lib/surfaceAreaCleaningQuote'
import { normalizeBiohazardCleaningClauses } from '@/lib/biohazardCleaningQuote'
import { sharedEngagementAgreement, withSharedEngagement } from '@/lib/quoteEngagement'
import type { CompanyProfile, DocType } from '@/lib/types'
import type { GenerateCheck, GenerateInputs } from './types'

/** Quote clauses exactly as /jobs/:id/docs/:type?compose=1 loads them. */
export function companyClauses(company: CompanyProfile | null) {
  const clearance = normalizeContentsClearanceStandards(company?.contents_clearance_standards)
  const surface = normalizeSurfaceAreaCleaningStandards(company?.surface_area_cleaning_standards)
  const engagement = sharedEngagementAgreement(clearance.engagement_agreement, surface.engagement_agreement)
  return {
    clearance: withSharedEngagement(clearance, engagement),
    surface: withSharedEngagement(surface, engagement),
    biohazardTemplate: normalizeBiohazardCleaningClauses(company?.biohazard_cleaning_standards ?? null, engagement),
    companyAddress: (company?.address ?? '').trim(),
  }
}

export function compose(type: DocType, inputs: GenerateInputs, extra: ComposeDocumentOptions = {}): GenerateCheck {
  const { content } = composeDocumentContent(type, inputs.job, {
    equipmentCatalogue: inputs.company?.equipment_catalogue ?? null,
    chemicalsCatalogue: inputs.company?.chemicals_catalogue ?? null,
    ...extra,
  })
  return { ok: true, content: content as Record<string, unknown> }
}

export function notStarted(docLabel: string): GenerateCheck {
  return { ok: false, reason: `The ${docLabel} has not been started on this job.` }
}

export const PRICE_RULE =
  'Prices and rates: leave them as they are unless the staff member gives the figure. Never invent or estimate a dollar amount, rate or fee.'
