/**
 * Inclusions, exclusions, and assumptions for one job only.
 * Saved on the job's quote capture, never on the company standards, so a new job starts without them.
 * Printed as extra dot points after the standard ones.
 */

export interface JobOnlyClauses {
  /** One item per line. */
  job_inclusions: string
  job_exclusions: string
  job_assumptions: string
}

export type JobOnlyClauseKey = keyof JobOnlyClauses

export function emptyJobOnlyClauses(): JobOnlyClauses {
  return { job_inclusions: '', job_exclusions: '', job_assumptions: '' }
}

export function normalizeJobOnlyClauses(o: Record<string, unknown>): JobOnlyClauses {
  const text = (key: JobOnlyClauseKey) => (typeof o[key] === 'string' ? o[key] as string : '')
  return {
    job_inclusions: text('job_inclusions'),
    job_exclusions: text('job_exclusions'),
    job_assumptions: text('job_assumptions'),
  }
}

/** The standard clause text with this job's lines added after it, one item per line. */
export function withJobOnlyLines(standard: string, jobOnly: string | null | undefined): string {
  const extra = (jobOnly ?? '').split('\n').map(line => line.trim()).filter(Boolean)
  if (!extra.length) return standard
  return [standard.replace(/\s+$/, ''), ...extra].filter(Boolean).join('\n')
}
