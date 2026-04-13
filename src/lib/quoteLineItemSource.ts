import type { AssessmentData, JobType } from '@/lib/types'
import { mergedSowCapture } from '@/lib/sowCapture'
import { sourceHash } from '@/lib/sourceHash'

export const QUOTE_SOURCE_SCHEMA_VERSION = 1 as const

export type QuoteLineItemSourceInput = {
  job_type: JobType
  notes: string | null
  assessment_data: AssessmentData | null
}

export function buildQuoteLineItemSource(input: QuoteLineItemSourceInput) {
  const ad = input.assessment_data
  const sow = mergedSowCapture(ad)
  return {
    schema_version: QUOTE_SOURCE_SCHEMA_VERSION,
    job_type: input.job_type,
    notes: (input.notes ?? '').trim(),
    scope_capture: {
      objective: (sow.objective || '').trim(),
      scope_work: (sow.scope_work || '').trim(),
      exclusions: (sow.exclusions || '').trim(),
    },
    areas: (ad?.areas ?? []).map(a => ({
      name: (a.name || '').trim(),
      description: (a.description || '').trim(),
    })),
    target_price: ad?.target_price ?? null,
    target_price_note: (ad?.target_price_note || '').trim(),
  }
}

export function quoteLineItemSourceHash(input: QuoteLineItemSourceInput): { hash: string; source: ReturnType<typeof buildQuoteLineItemSource> } {
  const source = buildQuoteLineItemSource(input)
  return { hash: sourceHash(source), source }
}
