/*
 * components/tabs/CompanyLetterTab.tsx
 *
 * Job File → Company Letter tab.
 *
 * UX:
 *   - Top: "Describe what you want" prompt box + Generate button. The prompt
 *     goes to /api/jobs/[id]/suggest-letter-body which returns only the body.
 *   - Bottom: a live letter "page" composed in company style — letterhead
 *     (logo/name/contact), date + reference, recipient block (client from the
 *     job), salutation, a single editable body field, sign-off, and a footer.
 *
 * The body is the ONLY editable letter field. Everything else is canonical
 * company/job data so the letterhead cannot drift per-letter. This keeps AI
 * backend-only and invisible to clients: what the client eventually receives
 * is just a human-reviewed letter in the company's own template.
 *
 * V1 scope: generate + edit body. Export/save comes next.
 */
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CompanyProfile, Job } from '@/lib/types'

interface Props {
  job: Job
}

const ACCENT = 'var(--accent)'

export default function CompanyLetterTab({ job }: Props) {
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [prompt, setPrompt] = useState('')
  const [body, setBody] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/company')
      .then(r => r.json())
      .then(d => setCompany(d.company ?? null))
      .catch(() => {})
  }, [])

  const today = useMemo(
    () => new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' }),
    [],
  )
  const reference = useMemo(() => `Ref: ${job.id.slice(0, 8).toUpperCase()}`, [job.id])

  async function generate() {
    if (!prompt.trim() || generating) return
    setError('')
    setGenerating(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}/suggest-letter-body`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, existing_body: body || undefined }),
      })
      const data = (await res.json()) as { body?: string; error?: string }
      if (!res.ok) throw new Error(data.error || 'Could not generate letter body')
      setBody((data.body ?? '').trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate letter body')
    } finally {
      setGenerating(false)
    }
  }

  const clientOrg = job.client_organization_name?.trim()
  const clientRole = job.client_contact_role?.trim()
  const recipientLines = [
    job.client_name,
    clientOrg || null,
    clientRole ? `(${clientRole})` : null,
    job.site_address,
  ].filter(Boolean) as string[]

  const greetingName = job.client_name?.split(' ')[0] || 'there'

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Prompt / generate card */}
      <div
        style={{
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          borderRadius: 12,
          padding: 16,
          display: 'grid',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Describe the letter</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            AI drafts the body only — letterhead, client block, and footer are composed from your company and job data.
          </div>
        </div>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={`e.g. "Follow-up letter to ${greetingName} confirming we're ready to proceed once authority to proceed is signed, and summarising the proposed timeline."`}
          rows={4}
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--surface-2)',
            color: 'var(--text)',
            fontSize: 13,
            lineHeight: 1.5,
            resize: 'vertical',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
        {error && (
          <div
            style={{
              border: '1px solid #7f1d1d',
              background: 'rgba(127,29,29,0.15)',
              color: '#fecaca',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={generate}
            disabled={!prompt.trim() || generating}
            style={{ fontSize: 13 }}
          >
            {generating ? 'Generating…' : body ? 'Regenerate body' : 'Generate letter body'}
          </button>
          {body && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setBody('')}
              style={{ fontSize: 12 }}
            >
              Clear body
            </button>
          )}
        </div>
      </div>

      {/* Composed letter — white "paper" on dark app bg, matches PDF styling */}
      <div
        style={{
          background: '#FFFFFF',
          color: '#111111',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '44px 52px 40px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
          fontFamily: 'Helvetica, Arial, sans-serif',
          minHeight: 680,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {/* Letterhead */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            {company?.logo_url ? (
              <img
                src={company.logo_url}
                alt={company.name || 'Company logo'}
                style={{ width: 140, maxHeight: 56, objectFit: 'contain', display: 'block' }}
              />
            ) : (
              <>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{company?.name || 'Company name'}</div>
                {company?.tagline && (
                  <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{company.tagline}</div>
                )}
              </>
            )}
            <div style={{ fontSize: 10, color: '#666', marginTop: 6, lineHeight: 1.5 }}>
              {[company?.phone, company?.email, company?.abn ? `ABN: ${company.abn}` : '']
                .filter(Boolean)
                .join('  ·  ')}
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 11, color: '#666' }}>
            <div>{reference}</div>
            <div style={{ marginTop: 2 }}>{today}</div>
            {company?.licence && <div style={{ marginTop: 2 }}>Lic: {company.licence}</div>}
          </div>
        </div>
        <div style={{ height: 2, background: ACCENT }} />

        {/* Recipient */}
        <div style={{ fontSize: 12, lineHeight: 1.6, color: '#111' }}>
          {recipientLines.map((line, i) => (
            <div key={i} style={i === 0 ? { fontWeight: 700 } : undefined}>
              {line}
            </div>
          ))}
        </div>

        {/* Salutation */}
        <div style={{ fontSize: 13 }}>Dear {greetingName},</div>

        {/* Body — the ONLY editable field */}
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="The generated letter body will appear here. You can edit freely."
          rows={Math.max(10, body.split('\n').length + 2)}
          style={{
            width: '100%',
            border: '1px dashed #D4D4D4',
            borderRadius: 6,
            padding: '12px 14px',
            background: '#FAFAFA',
            color: '#111',
            fontSize: 13,
            lineHeight: 1.7,
            fontFamily: 'Helvetica, Arial, sans-serif',
            resize: 'vertical',
            boxSizing: 'border-box',
            outline: 'none',
          }}
          onFocus={e => {
            e.currentTarget.style.borderColor = ACCENT as string
            e.currentTarget.style.background = '#FFFFFF'
          }}
          onBlur={e => {
            e.currentTarget.style.borderColor = '#D4D4D4'
            e.currentTarget.style.background = '#FAFAFA'
          }}
        />

        {/* Sign-off */}
        <div style={{ fontSize: 13, marginTop: 8 }}>
          <div>Kind regards,</div>
          <div style={{ marginTop: 36, fontWeight: 700 }}>{company?.name || 'Company name'}</div>
        </div>

        {/* Footer */}
        <div style={{ flex: 1 }} />
        <div
          style={{
            borderTop: '1px solid #E5E5E5',
            paddingTop: 10,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 9,
            color: '#666',
          }}
        >
          <div>
            {[company?.name, company?.address].filter(Boolean).join(' — ') ||
              'Company address'}
          </div>
          <div style={{ color: ACCENT as string }}>biohazards.net</div>
        </div>
      </div>
    </div>
  )
}
