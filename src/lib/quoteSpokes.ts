/*
 * lib/quoteSpokes.ts
 *
 * Hub-and-spoke quotes. The Assessment data (assessment_data minus the quotes)
 * is the shared source-of-truth "hub". Each entry in `assessment_data.outcome_quotes`
 * is an independent "spoke": a named, self-contained quote that reads from the
 * hub but owns its own selection, pricing, terms, and totals.
 *
 * Back-compat: jobs created before multi-quote have a single
 * `outcome_quote_capture`. `getQuoteSpokes` transparently wraps that into a
 * one-element array (id 'default') so every existing job keeps working with no
 * migration. The first save through QuoteCaptureTab persists `outcome_quotes`.
 */
import type { AssessmentData, OutcomeQuoteCapture, QuoteSpoke } from '@/lib/types'

/** Stable id for a new spoke (also used as the document `quote_id`). */
export function genQuoteSpokeId(): string {
  return `quote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** A fresh, empty capture with the required-field defaults satisfied. */
export function makeBlankCapture(): OutcomeQuoteCapture {
  return {
    mode: 'outcomes',
    rows: [],
    totals: { subtotal: 0, gst: 0, total: 0 },
    target_pricing: {},
    gst_mode: 'no_gst',
  }
}

/** A fresh, empty spoke ready to edit. */
export function makeBlankSpoke(label: string): QuoteSpoke {
  const now = new Date().toISOString()
  return { ...makeBlankCapture(), id: genQuoteSpokeId(), label, created_at: now, updated_at: now }
}

/**
 * Read all quote spokes for a job. Returns the modern `outcome_quotes` array
 * when present, otherwise wraps a legacy `outcome_quote_capture` into a single
 * spoke. Returns [] when the job has no quote data at all.
 */
export function getQuoteSpokes(ad: AssessmentData | null | undefined): QuoteSpoke[] {
  if (!ad) return []
  if (Array.isArray(ad.outcome_quotes) && ad.outcome_quotes.length > 0) {
    return ad.outcome_quotes
  }
  const legacy = ad.outcome_quote_capture
  if (legacy) {
    const now = new Date().toISOString()
    return [{ ...legacy, id: 'default', label: 'Quote', created_at: now, updated_at: now }]
  }
  return []
}

/** Read all spokes, guaranteeing at least one (a blank "Quote 1") to edit. */
export function getQuoteSpokesOrSeed(ad: AssessmentData | null | undefined): QuoteSpoke[] {
  const spokes = getQuoteSpokes(ad)
  return spokes.length > 0 ? spokes : [makeBlankSpoke('Quote 1')]
}

/** Find a single spoke by id (back-compat aware). */
export function getSpokeById(
  ad: AssessmentData | null | undefined,
  id: string | null | undefined,
): QuoteSpoke | undefined {
  if (!id) return undefined
  return getQuoteSpokes(ad).find(s => s.id === id)
}
