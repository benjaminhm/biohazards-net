/*
 * Quote capture — workflow from Scope of Work into pricing (QuoteTab) and generated quote PDF.
 * Opened from Home → Data Capture → Quote.
 */
'use client'

import QuoteTab from '@/components/tabs/QuoteTab'
import type { Job, Document } from '@/lib/types'
import { mergedSowCapture, staffSowHasContent } from '@/lib/sowCapture'

interface Props {
  job: Job
  documents: Document[]
  onJobUpdate: (job: Job) => void
  onGoToScope?: () => void
}

function truncate(s: string, max: number) {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max).trim()}…`
}

export default function QuoteCaptureTab({ job, documents, onJobUpdate, onGoToScope }: Props) {
  const sow = mergedSowCapture(job.assessment_data)
  const hasScope = staffSowHasContent(job.assessment_data)

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 18 }}>
        Set pricing and terms here; the generated quote uses your{' '}
        <strong style={{ color: 'var(--text)' }}>Scope of Work</strong> capture plus assessment and hazards so line items
        and wording stay aligned with the agreed scope.
      </p>

      <div
        style={{
          marginBottom: 28,
          padding: '16px 18px',
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'var(--surface-2)',
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            marginBottom: 10,
          }}
        >
          Scope of Work (summary)
        </div>
        {hasScope ? (
          <>
            <p style={{ fontSize: 14, lineHeight: 1.5, margin: '0 0 12px', color: 'var(--text)' }}>
              {sow.objective.trim()
                ? truncate(sow.objective, 320)
                : truncate(sow.scope_work || sow.methodology, 320) || 'Scope fields present — open Scope of Work for full detail.'}
            </p>
            {onGoToScope && (
              <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }} onClick={onGoToScope}>
                Edit scope of work
              </button>
            )}
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
              No scope capture yet. Capture objective and scope first so the quote can reference the same intent.
            </p>
            {onGoToScope && (
              <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }} onClick={onGoToScope}>
                Open Scope of Work
              </button>
            )}
          </>
        )}
      </div>

      <QuoteTab job={job} documents={documents} onJobUpdate={onJobUpdate} />
    </div>
  )
}
