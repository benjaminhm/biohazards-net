/*
 * Assessment / Scope / Quote — unified staff capture on one tab.
 * Combines Assessment → Document, Scope of Work, and Quote pricing fields in assessment_data
 * (same persistence as the separate tabs). One top-level generate uses Presentation + HITL hazards/risks
 * (same APIs as the old per-section suggests). Per-field Listen / AI polish unchanged.
 */
'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import type { Job, AssessmentData, AssessmentDocumentCapture, SowCapture, Document } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { mergedSowCapture } from '@/lib/sowCapture'
import { mergedAssessmentDocumentCapture } from '@/lib/assessmentDocumentCapture'
import { assessmentSaveContentBlocksPayload } from '@/lib/contentBlocks'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'

interface Props {
  job: Job
  documents: Document[]
  onJobUpdate: (job: Job) => void
}

const BUBBLE: CSSProperties = {
  width: '100%',
  minHeight: 120,
  padding: '16px 18px',
  borderRadius: 18,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 15,
  lineHeight: 1.55,
  resize: 'vertical' as const,
  fontFamily: 'inherit',
}

const AD_FIELDS: { key: keyof AssessmentDocumentCapture; label: string; placeholder: string }[] = [
  { key: 'site_summary', label: 'Site summary', placeholder: 'Site context, access, and relevant conditions from Presentation…' },
  { key: 'hazards_overview', label: 'Hazards overview', placeholder: 'Summarise presenting and candidate hazards…' },
  { key: 'risks_overview', label: 'Risks overview', placeholder: 'Summarise risk picture and ratings where known…' },
  { key: 'control_measures', label: 'Control measures', placeholder: 'Engineering, administrative, PPE, sequencing…' },
  { key: 'recommendations', label: 'Recommendations', placeholder: 'Next steps, staging, or follow-up assessment needs…' },
  { key: 'limitations', label: 'Limitations', placeholder: 'What was not assessed, assumptions, caveats…' },
]

const SOW_FIELDS: { key: keyof SowCapture; label: string; placeholder: string }[] = [
  { key: 'objective', label: 'Objective', placeholder: 'The single outcome this remediation is meant to achieve…' },
  { key: 'scope_work', label: 'Scope / work narrative', placeholder: 'What will be done, where, and to what standard…' },
  { key: 'methodology', label: 'Methodology', placeholder: 'How you will approach the work (containment, sequence, verification)…' },
  { key: 'timeline', label: 'Timeline', placeholder: 'Duration, milestones, access windows…' },
  { key: 'safety', label: 'Safety & PPE', placeholder: 'PPE, containment, site safety (can reference Assessment flags)…' },
  { key: 'waste', label: 'Waste', placeholder: 'Packaging, transport, disposal expectations…' },
  { key: 'exclusions', label: 'Exclusions', placeholder: 'What is explicitly not included in this scope…' },
  { key: 'caveats', label: 'Caveats / disclaimer', placeholder: 'Assumptions, limits, subject-to conditions…' },
]

const DEFAULT_PAYMENT_TERMS = '50% deposit required prior to works commencing. Remainder due on completion, net 7 days.'
const DEFAULT_TERMS = `50% deposit required to confirm booking. Remainder payable on completion within 7 days of invoice. Late payments attract interest at 10% p.a. All biohazardous waste disposed of in accordance with applicable legislation. Contractor not liable for pre-existing structural damage. Client warrants authority to engage contractor for works at the stated premises.`

function quoteMergeDefaults(saved: AssessmentData | null) {
  return {
    target_price: saved?.target_price ?? undefined,
    target_price_note: saved?.target_price_note ?? '',
    payment_terms: saved?.payment_terms ?? DEFAULT_PAYMENT_TERMS,
    terms_and_conditions: saved?.terms_and_conditions ?? DEFAULT_TERMS,
  }
}

type QuoteFields = ReturnType<typeof quoteMergeDefaults>

function bundleEqual(
  job: Job,
  ad: AssessmentDocumentCapture,
  sow: SowCapture,
  q: QuoteFields,
): boolean {
  const pa = mergedAssessmentDocumentCapture(job.assessment_data)
  const ps = mergedSowCapture(job.assessment_data)
  const pq = quoteMergeDefaults(job.assessment_data)
  const adOk = AD_FIELDS.every(({ key }) => (ad[key] ?? '') === (pa[key] ?? ''))
  const sowOk = SOW_FIELDS.every(({ key }) => (sow[key] ?? '') === (ps[key] ?? ''))
  const qOk =
    q.target_price === pq.target_price &&
    q.target_price_note === pq.target_price_note &&
    q.payment_terms === pq.payment_terms &&
    q.terms_and_conditions === pq.terms_and_conditions
  return adOk && sowOk && qOk
}

const sectionLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--accent)',
  marginBottom: 10,
  marginTop: 22,
}

const blockTitle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--accent)',
  marginBottom: 12,
  marginTop: 32,
}

export default function IaqBundleCaptureTab({ job, documents, onJobUpdate }: Props) {
  const persistedAd = mergedAssessmentDocumentCapture(job.assessment_data)
  const persistedSow = mergedSowCapture(job.assessment_data)
  const persistedQuote = quoteMergeDefaults(job.assessment_data)

  const [adCapture, setAdCapture] = useState<AssessmentDocumentCapture>(persistedAd)
  const [sowCapture, setSowCapture] = useState<SowCapture>(persistedSow)
  const [quoteFields, setQuoteFields] = useState<QuoteFields>(persistedQuote)

  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [polishError, setPolishError] = useState<string | null>(null)

  /** Applies to the single “Generate” action for both Assessment and Scope drafts. */
  const [suggestMergeMode, setSuggestMergeMode] = useState<'fill_empty' | 'replace_all'>('replace_all')
  const [generatingFromSource, setGeneratingFromSource] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)

  const [polishingKey, setPolishingKey] = useState<string | null>(null)
  const [speakingKey, setSpeakingKey] = useState<string | null>(null)

  useEffect(() => {
    setAdCapture(mergedAssessmentDocumentCapture(job.assessment_data))
    setSowCapture(mergedSowCapture(job.assessment_data))
    setQuoteFields(quoteMergeDefaults(job.assessment_data))
  }, [job.id])

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  const isDirty = !bundleEqual(job, adCapture, sowCapture, quoteFields)
  useRegisterUnsavedChanges('iaq-bundle-capture', isDirty)

  function setAdField(key: keyof AssessmentDocumentCapture, value: string) {
    setAdCapture(c => ({ ...c, [key]: value }))
    setSavedFlash(false)
    setSaveError(null)
    setPolishError(null)
    setGenerateError(null)
  }

  function setSowField(key: keyof SowCapture, value: string) {
    setSowCapture(c => ({ ...c, [key]: value }))
    setSavedFlash(false)
    setSaveError(null)
    setPolishError(null)
    setGenerateError(null)
  }

  function setQuote<K extends keyof QuoteFields>(key: K, value: QuoteFields[K]) {
    setQuoteFields(f => ({ ...f, [key]: value }))
    setSavedFlash(false)
    setSaveError(null)
    setGenerateError(null)
  }

  async function generateFromPresentationAndHazards() {
    setGeneratingFromSource(true)
    setGenerateError(null)
    try {
      const [adRes, sowRes] = await Promise.all([
        fetch(`/api/jobs/${job.id}/suggest-assessment-document`, { method: 'POST' }),
        fetch(`/api/jobs/${job.id}/suggest-sow-capture`, { method: 'POST' }),
      ])
      const adData = (await adRes.json()) as { suggestions?: AssessmentDocumentCapture; error?: string }
      const sowData = (await sowRes.json()) as { suggestions?: SowCapture; error?: string }
      if (!adRes.ok) throw new Error(adData.error || 'Assessment draft failed')
      if (!sowRes.ok) throw new Error(sowData.error || 'Scope draft failed')
      const adS = adData.suggestions
      const sowS = sowData.suggestions
      if (!adS) throw new Error('No assessment draft returned')
      if (!sowS) throw new Error('No scope draft returned')

      setAdCapture(prev => {
        if (suggestMergeMode === 'replace_all') return { ...prev, ...adS }
        const next = { ...prev }
        for (const { key } of AD_FIELDS) {
          if (!(prev[key] ?? '').trim()) next[key] = adS[key] ?? ''
        }
        return next
      })
      setSowCapture(prev => {
        if (suggestMergeMode === 'replace_all') return { ...prev, ...sowS }
        const next = { ...prev }
        for (const { key } of SOW_FIELDS) {
          if (!(prev[key] ?? '').trim()) next[key] = sowS[key] ?? ''
        }
        return next
      })
      setSavedFlash(false)
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : 'Generate failed')
    } finally {
      setGeneratingFromSource(false)
    }
  }

  async function save() {
    setSaving(true)
    setSavedFlash(false)
    setSaveError(null)
    try {
      const merged: AssessmentData = {
        ...mergeAssessmentData(job.assessment_data),
        assessment_document_capture: adCapture,
        ...assessmentSaveContentBlocksPayload(adCapture),
        sow_capture: sowCapture,
        sow_objective: sowCapture.objective,
        target_price: quoteFields.target_price,
        target_price_note: quoteFields.target_price_note,
        payment_terms: quoteFields.payment_terms,
        terms_and_conditions: quoteFields.terms_and_conditions,
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: merged }),
      })
      const resp = await res.json()
      if (!res.ok) throw new Error(resp.error || 'Save failed')
      onJobUpdate(resp.job)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function handleListen(prefix: 'ad' | 'sow', key: string) {
    if (typeof window === 'undefined') return
    const fullKey = `${prefix}:${key}`
    if (speakingKey === fullKey) {
      window.speechSynthesis.cancel()
      setSpeakingKey(null)
      return
    }
    const text =
      prefix === 'ad'
        ? (adCapture[key as keyof AssessmentDocumentCapture] ?? '').trim()
        : (sowCapture[key as keyof SowCapture] ?? '').trim()
    if (!text) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-AU'
    u.onstart = () => setSpeakingKey(fullKey)
    u.onend = () => setSpeakingKey(null)
    u.onerror = () => setSpeakingKey(null)
    window.speechSynthesis.speak(u)
  }

  async function handlePolish(prefix: 'ad' | 'sow', key: keyof AssessmentDocumentCapture | keyof SowCapture) {
    const text =
      prefix === 'ad'
        ? (adCapture[key as keyof AssessmentDocumentCapture] ?? '').trim()
        : (sowCapture[key as keyof SowCapture] ?? '').trim()
    if (!text) return
    setPolishError(null)
    setPolishingKey(`${prefix}:${String(key)}`)
    try {
      const res = await fetch(`/api/jobs/${job.id}/polish-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Polish failed')
      const next = typeof data.text === 'string' ? data.text : text
      if (prefix === 'ad') {
        setAdField(key as keyof AssessmentDocumentCapture, next)
      } else {
        setSowField(key as keyof SowCapture, next)
      }
    } catch (e) {
      setPolishError(e instanceof Error ? e.message : 'Polish failed')
    } finally {
      setPolishingKey(null)
    }
  }

  const existingAssessmentDoc = documents.find(d => d.type === 'assessment_document')
  const existingSow = documents.find(d => d.type === 'sow')
  const existingQuote = documents.find(d => d.type === 'quote')
  const existingIaqMulti = documents.find(d => d.type === 'iaq_multi')

  const quoteSection = (title: string) => (
    <div style={{ ...blockTitle, marginTop: title === 'Pricing' ? 8 : 28 }}>{title}</div>
  )

  return (
    <div style={{ paddingBottom: 40, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
        Assessment / Scope / Quote
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.55 }}>
        Unified capture for internal assessment narrative, scope of work, and quote inputs. Saved on the job (same fields
        as Assessment → Document, Scope of Work, and Quote). Use Generate below to draft Assessment and Scope text from
        your Presentation, photo captions, and Hazards/Risks (HITL) only—then edit and save. Quote pricing and terms are
        manual unless you adjust them elsewhere.
      </p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          marginBottom: 24,
          padding: '16px 18px',
          background: 'var(--surface-2)',
          border: '1px solid var(--accent)',
          borderRadius: 12,
          boxShadow: '0 0 0 1px rgba(255,107,53,0.12)',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>
          Generate Assessment &amp; Scope from source
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          Runs the same grounded drafts as the separate Assessment and Scope suggest APIs (Presentation context + presenting
          hazards/risks). Does not use quote fields.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Apply draft:</span>
            <select
              value={suggestMergeMode}
              onChange={e => setSuggestMergeMode(e.target.value as 'fill_empty' | 'replace_all')}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 13,
              }}
            >
              <option value="replace_all">Replace all Assessment &amp; Scope fields</option>
              <option value="fill_empty">Fill empty fields only</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={generatingFromSource}
          onClick={() => void generateFromPresentationAndHazards()}
          style={{ alignSelf: 'flex-start', padding: '12px 20px', fontSize: 15 }}
        >
          {generatingFromSource ? (
            <>
              <span className="spinner" /> Generating…
            </>
          ) : (
            'Generate from Presentation &amp; hazards'
          )}
        </button>
        {generateError && (
          <p style={{ fontSize: 13, color: '#F87171', margin: 0 }} role="alert">
            {generateError}
          </p>
        )}
      </div>

      {/* ── Assessment (document capture) ── */}
      <div style={{ ...blockTitle, marginTop: 0 }}>1. Assessment (document capture)</div>

      {AD_FIELDS.map(({ key, label, placeholder }, i) => (
        <div key={`ad-${key}`}>
          <div style={i === 0 ? { ...sectionLabelStyle, marginTop: 0 } : sectionLabelStyle}>{label}</div>
          <textarea
            value={adCapture[key]}
            onChange={e => setAdField(key, e.target.value)}
            placeholder={placeholder}
            style={BUBBLE}
            aria-label={label}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!(adCapture[key] ?? '').trim() && speakingKey !== `ad:${key}`}
              onClick={() => handleListen('ad', key)}
            >
              {speakingKey === `ad:${key}` ? 'Stop' : 'Listen'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!(adCapture[key] ?? '').trim() || polishingKey !== null}
              onClick={() => void handlePolish('ad', key)}
            >
              {polishingKey === `ad:${key}` ? 'Polishing…' : 'AI polish'}
            </button>
          </div>
        </div>
      ))}

      {/* ── Scope of work ── */}
      <div style={blockTitle}>2. Scope of work</div>

      {SOW_FIELDS.map(({ key, label, placeholder }, i) => (
        <div key={`sow-${key}`}>
          <div style={i === 0 ? { ...sectionLabelStyle, marginTop: 0 } : sectionLabelStyle}>{label}</div>
          <textarea
            value={sowCapture[key]}
            onChange={e => setSowField(key, e.target.value)}
            placeholder={placeholder}
            style={BUBBLE}
            aria-label={label}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!(sowCapture[key] ?? '').trim() && speakingKey !== `sow:${key}`}
              onClick={() => handleListen('sow', key)}
            >
              {speakingKey === `sow:${key}` ? 'Stop' : 'Listen'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!(sowCapture[key] ?? '').trim() || polishingKey !== null}
              onClick={() => void handlePolish('sow', key)}
            >
              {polishingKey === `sow:${key}` ? 'Polishing…' : 'AI polish'}
            </button>
          </div>
        </div>
      ))}

      {/* ── Quote settings (same as Quote tab) ── */}
      <div style={blockTitle}>3. Quote</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.55 }}>
        Pricing and terms feed Quote and Engagement Agreement generation; line items in generated quotes align with your
        scope capture above.
      </p>

      {quoteSection('Pricing')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <div className="field">
          <label>
            Target Amount
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
              Claude works line items back from this
            </span>
          </label>
          <div style={{ position: 'relative' }}>
            <span
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                fontSize: 15,
                fontWeight: 600,
                pointerEvents: 'none',
              }}
            >
              $
            </span>
            <input
              type="number"
              value={quoteFields.target_price ?? ''}
              onChange={e => {
                const n = parseFloat(e.target.value)
                setQuote('target_price', isNaN(n) ? undefined : n)
              }}
              placeholder="0.00"
              min="0"
              step="50"
              style={{ paddingLeft: 24 }}
            />
          </div>
        </div>
        <div className="field">
          <label>GST Note</label>
          <input
            type="text"
            value={quoteFields.target_price_note}
            onChange={e => setQuote('target_price_note', e.target.value)}
            placeholder="e.g. inc. GST  or  + GST"
          />
        </div>
      </div>

      {quoteSection('Payment Terms')}
      <div className="field">
        <textarea
          value={quoteFields.payment_terms}
          onChange={e => setQuote('payment_terms', e.target.value)}
          rows={3}
          style={{ resize: 'vertical' }}
        />
      </div>

      {quoteSection('Terms & Conditions')}
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, marginTop: -6, lineHeight: 1.5 }}>
        Included in Quote and Engagement Agreement documents.
      </p>
      <div className="field">
        <textarea
          value={quoteFields.terms_and_conditions}
          onChange={e => setQuote('terms_and_conditions', e.target.value)}
          rows={6}
          style={{ resize: 'vertical', fontSize: 13 }}
        />
      </div>

      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void save()}
        disabled={saving || !isDirty}
        style={{ width: '100%', padding: 14, fontSize: 15, marginTop: 28 }}
      >
        {saving ? (
          <>
            <span className="spinner" /> Saving…
          </>
        ) : savedFlash && !isDirty ? (
          '✓ Saved'
        ) : (
          'Save Assessment / Scope / Quote'
        )}
      </button>

      {saveError && (
        <p style={{ fontSize: 13, color: '#F87171', marginTop: 10 }} role="alert">
          {saveError}
        </p>
      )}
      {polishError && (
        <p style={{ fontSize: 13, color: '#F87171', marginTop: 10 }} role="alert">
          {polishError}
        </p>
      )}

      <div style={{ ...blockTitle, marginTop: 36 }}>Generated documents</div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
        Open composers from Home → Generate documents, or jump to saved rows below.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {existingAssessmentDoc ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 10,
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Assessment</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {new Date(existingAssessmentDoc.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            </div>
            <Link href={`/jobs/${job.id}/docs/assessment_document?docId=${existingAssessmentDoc.id}`}>
              <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }}>Edit →</button>
            </Link>
          </div>
        ) : (
          <Link href={`/jobs/${job.id}/docs/assessment_document?compose=1`}>
            <button type="button" className="btn btn-secondary" style={{ width: '100%', padding: 12, fontSize: 13 }}>
              ＋ Compose Assessment
            </button>
          </Link>
        )}

        {existingSow ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 10,
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Scope of Work</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {new Date(existingSow.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            </div>
            <Link href={`/jobs/${job.id}/docs/sow?docId=${existingSow.id}`}>
              <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }}>Edit →</button>
            </Link>
          </div>
        ) : (
          <Link href={`/jobs/${job.id}/docs/sow?compose=1`}>
            <button type="button" className="btn btn-secondary" style={{ width: '100%', padding: 12, fontSize: 13 }}>
              ＋ Compose Scope of Work
            </button>
          </Link>
        )}

        {existingQuote ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 10,
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Quote</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {new Date(existingQuote.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            </div>
            <Link href={`/jobs/${job.id}/docs/quote?docId=${existingQuote.id}`}>
              <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }}>Edit →</button>
            </Link>
          </div>
        ) : (
          <Link href={`/jobs/${job.id}/docs/quote`}>
            <button type="button" className="btn btn-secondary" style={{ width: '100%', padding: 12, fontSize: 13 }}>
              ＋ Generate Quote with Claude
            </button>
          </Link>
        )}

        {existingIaqMulti ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 10,
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Assessment / Scope / Quote (bundle)</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {new Date(existingIaqMulti.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            </div>
            <Link href={`/jobs/${job.id}/docs/iaq_multi?docId=${existingIaqMulti.id}`}>
              <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }}>Edit →</button>
            </Link>
          </div>
        ) : (
          <Link href={`/jobs/${job.id}/docs/iaq_multi?compose=1`}>
            <button type="button" className="btn btn-secondary" style={{ width: '100%', padding: 12, fontSize: 13 }}>
              ＋ Compose Assessment / Scope / Quote bundle
            </button>
          </Link>
        )}
      </div>
    </div>
  )
}
