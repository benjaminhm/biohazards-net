/*
 * components/tabs/CompanyLetterTab.tsx
 *
 * Job File → Company Letter tab.
 *
 * Writes one editable body field for a professional letter. Letterhead,
 * recipient block, date, sign-off, and footer are composed from canonical
 * company + job data so the template can't drift per-letter.
 *
 * Rendered as plain dark-theme text (no white "paper") so the whole letter
 * can be copied and pasted straight into an email. A "Copy letter" button
 * puts the full composed plain-text version on the clipboard.
 *
 * "Save to Docs" writes a documents row with type: 'company_letter' so the
 * letter is part of the job file record (Docs tab → Saved Documents).
 *
 * HITL + AI boundary: AI drafts the body only (see suggest-letter-body); the
 * letter is never auto-sent — staff copy it and send it themselves.
 */
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CompanyProfile, Job } from '@/lib/types'

interface Props {
  job: Job
}

export default function CompanyLetterTab({ job }: Props) {
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [prompt, setPrompt] = useState('')
  const [body, setBody] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [copiedAt, setCopiedAt] = useState<number | null>(null)
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

  const clientOrg = job.client_organization_name?.trim()
  const clientRole = job.client_contact_role?.trim()
  const recipientLines = [
    job.client_name,
    clientOrg || null,
    clientRole ? `(${clientRole})` : null,
    job.site_address,
  ].filter(Boolean) as string[]

  const greetingName = job.client_name?.split(' ')[0] || 'there'

  const contactLine = [
    company?.phone,
    company?.email,
    company?.abn ? `ABN: ${company.abn}` : '',
  ]
    .filter(Boolean)
    .join('  ·  ')

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
      setSavedAt(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate letter body')
    } finally {
      setGenerating(false)
    }
  }

  /** Build the full plain-text letter (letterhead → footer) for clipboard + Save. */
  function buildPlainText(): string {
    const companyName = company?.name || 'Company name'
    const tagline = company?.tagline || ''
    const licence = company?.licence ? `Lic: ${company.licence}` : ''
    const address = company?.address || ''

    const headBlock = [
      companyName,
      tagline,
      contactLine,
      licence,
    ].filter(Boolean).join('\n')

    const metaBlock = [reference, today].filter(Boolean).join('\n')
    const recipient = recipientLines.join('\n')
    const footer = [companyName, address].filter(Boolean).join(' — ')

    return [
      headBlock,
      '',
      metaBlock,
      '',
      recipient,
      '',
      `Dear ${greetingName},`,
      '',
      body.trim() || '[letter body]',
      '',
      'Kind regards,',
      '',
      companyName,
      '',
      '—',
      footer,
    ].join('\n')
  }

  async function copyLetter() {
    try {
      await navigator.clipboard.writeText(buildPlainText())
      setCopiedAt(Date.now())
      window.setTimeout(() => setCopiedAt(c => (c && Date.now() - c >= 1800 ? null : c)), 2000)
    } catch {
      setError('Could not copy — your browser blocked clipboard access.')
    }
  }

  async function saveToDocs() {
    if (!body.trim() || saving) return
    setError('')
    setSaving(true)
    try {
      const content = {
        schema_version: 1,
        prompt: prompt.trim() || null,
        reference,
        date: today,
        body: body.trim(),
        plain_text: buildPlainText(),
        recipient_snapshot: {
          client_name: job.client_name,
          client_organization_name: clientOrg || null,
          client_contact_role: clientRole || null,
          site_address: job.site_address,
        },
        company_snapshot: company
          ? {
              name: company.name,
              tagline: company.tagline,
              phone: company.phone,
              email: company.email,
              address: company.address,
              licence: company.licence,
              abn: company.abn,
            }
          : null,
      }
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: job.id,
          type: 'company_letter',
          content,
        }),
      })
      const data = (await res.json()) as { document?: { id: string; created_at: string }; error?: string }
      if (!res.ok) throw new Error(data.error || 'Could not save letter')
      setSavedAt(data.document?.created_at ?? new Date().toISOString())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save letter')
    } finally {
      setSaving(false)
    }
  }

  // ── Styles ───────────────────────────────────────────────
  const META_LABEL: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    marginBottom: 6,
  }

  const LETTER_LINE: React.CSSProperties = {
    fontSize: 14,
    lineHeight: 1.65,
    color: 'var(--text)',
    fontFamily: 'Georgia, "Times New Roman", serif',
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* ── Prompt / generate card ─────────────────────────── */}
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
          placeholder={`e.g. "Follow-up to ${greetingName} confirming we're ready to proceed once the authority to proceed is signed, with a short outline of the proposed timeline."`}
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={copyLetter}
                style={{ fontSize: 12 }}
              >
                {copiedAt ? '✓ Copied full letter' : '📋 Copy letter'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={saveToDocs}
                disabled={saving}
                style={{ fontSize: 12 }}
              >
                {saving ? 'Saving…' : savedAt ? '✓ Saved to Docs' : '💾 Save to Docs'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setBody('')
                  setSavedAt(null)
                }}
                style={{ fontSize: 12 }}
              >
                Clear body
              </button>
            </>
          )}
          {savedAt && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Last saved {new Date(savedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* ── Composed letter, dark theme, copy-pasteable ─────── */}
      <div
        style={{
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          borderRadius: 12,
          padding: '28px 32px 32px',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        {/* Letterhead */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em' }}>
              {company?.name || 'Company name'}
            </div>
            {company?.tagline && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {company.tagline}
              </div>
            )}
            {contactLine && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                {contactLine}
              </div>
            )}
            {company?.licence && (
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                Lic: {company.licence}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>
            <div>{reference}</div>
            <div style={{ marginTop: 2 }}>{today}</div>
          </div>
        </div>

        <div style={{ height: 2, background: 'var(--accent)', opacity: 0.85 }} />

        {/* Recipient */}
        <div>
          <div style={META_LABEL}>To</div>
          <div style={LETTER_LINE}>
            {recipientLines.map((line, i) => (
              <div key={i} style={i === 0 ? { fontWeight: 700 } : undefined}>
                {line}
              </div>
            ))}
          </div>
        </div>

        {/* Salutation */}
        <div style={LETTER_LINE}>Dear {greetingName},</div>

        {/* Body — the only editable field */}
        <div>
          <div style={META_LABEL}>Body</div>
          <textarea
            value={body}
            onChange={e => {
              setBody(e.target.value)
              setSavedAt(null)
            }}
            placeholder="Describe what you want above and click Generate, or write the body directly here."
            rows={Math.max(10, body.split('\n').length + 2)}
            style={{
              width: '100%',
              border: '1px solid var(--border-2)',
              borderRadius: 10,
              padding: '14px 16px',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              fontSize: 14,
              lineHeight: 1.7,
              fontFamily: 'Georgia, "Times New Roman", serif',
              resize: 'vertical',
              boxSizing: 'border-box',
              outline: 'none',
              transition: 'border-color 0.12s, background 0.12s',
            }}
            onFocus={e => {
              e.currentTarget.style.borderColor = 'var(--accent)'
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = 'var(--border-2)'
            }}
          />
        </div>

        {/* Sign-off */}
        <div style={LETTER_LINE}>
          <div>Kind regards,</div>
          <div style={{ marginTop: 28, fontWeight: 700 }}>{company?.name || 'Company name'}</div>
        </div>

        {/* Footer */}
        <div
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: 10,
            marginTop: 6,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 11,
            color: 'var(--text-dim)',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div>
            {[company?.name, company?.address].filter(Boolean).join(' — ') || 'Company address'}
          </div>
          <div style={{ color: 'var(--accent)' }}>biohazards.net</div>
        </div>
      </div>
    </div>
  )
}
