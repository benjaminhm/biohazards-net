'use client'

/*
 * Fast Quote (stored as `instant_quote`): one fixed price, quoted without a site inspection, for a scope
 * written from what the client reported. The only photos on it are ones the client supplied.
 *
 * Staff tick the services, type or dictate what the client reported, and type the price. "Draft the wording" asks the
 * model for the presentation, scope, inclusions, exclusions and assumptions; staff read and edit them here.
 * The price is only ever typed by staff. Generate opens the standard document page, and the saved quote is
 * sent for signing from the Documents tab like any other quote.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import CaptureFieldToolbar from '@/components/CaptureFieldToolbar'
import SelectedPhotos from '@/components/SelectedPhotos'
import { usedPhotoIds } from '@/lib/photoSelection'
import type { Job, Photo } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import { formatAud } from '@/lib/disposalManifest'
import {
  INSTANT_QUOTE_SCHEMA,
  INSTANT_QUOTE_SERVICES,
  emptyInstantQuoteCapture,
  instantQuoteFigures,
  instantQuoteLines,
  instantQuoteProblems,
  instantQuoteStandardAssumptions,
  instantQuoteStandardExclusions,
  instantQuoteStandardInclusions,
  instantQuoteStartLabel,
  instantQuoteTitle,
  normalizeInstantQuoteCapture,
  type InstantQuoteCapture,
  type InstantQuoteService,
} from '@/lib/instantQuote'
import { INSTANT_DRAFT_DROP_LABELS, INSTANT_QUOTE_BRIEF_MIN_CHARS, type InstantQuoteDraft } from '@/lib/instantQuoteDraft'

interface Props {
  job: Job
  photos: Photo[]
  onJobUpdate: (job: Job) => void
  onPhotosUpdate: (photos: Photo[]) => void
}

const INPUT: CSSProperties = {
  width: '100%',
  fontSize: 14,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
}

const TEXTAREA: CSSProperties = { ...INPUT, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }

const LABEL: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
  color: 'var(--text-muted)',
}

const HINT: CSSProperties = { fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }

const SECTION: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
  marginTop: 14,
}

/**
 * A capture not yet saved starts from the voice brief and client photos of the older Fast Quote box, on jobs
 * that used it before it was removed from Onsite Assessment. Otherwise its brief starts from the job
 * description the call agent wrote.
 */
function savedCapture(job: Job): InstantQuoteCapture {
  const raw = job.assessment_data?.instant_quote
  if (raw != null) return normalizeInstantQuoteCapture(raw)
  const voice = job.assessment_data?.fast_quote?.enabled ? job.assessment_data.fast_quote : null
  return {
    ...emptyInstantQuoteCapture(),
    brief: (voice?.transcript ?? '').trim() || (job.job_description ?? '').trim(),
    ...(Array.isArray(voice?.photo_ids) ? { photo_ids: voice.photo_ids } : {}),
  }
}

function StandardLines({ lines }: { lines: string[] }) {
  return (
    <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 13, display: 'grid', gap: 4, color: 'var(--text-muted)' }}>
      {lines.map(line => <li key={line}>{line}</li>)}
    </ul>
  )
}

export default function InstantQuoteTab({ job, photos, onJobUpdate, onPhotosUpdate }: Props) {
  const router = useRouter()
  const saved = useMemo(() => savedCapture(job), [job])
  const [capture, setCapture] = useState<InstantQuoteCapture>(saved)
  const [saving, setSaving] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [error, setError] = useState('')
  const [dropped, setDropped] = useState<InstantQuoteDraft['dropped']>([])
  const usedIds = useMemo(() => usedPhotoIds(job.assessment_data, photos), [job.assessment_data, photos])

  useEffect(() => {
    setCapture(savedCapture(job))
    // Reload only when the saved job changes, not on every render of the same job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, job.updated_at])

  const isDirty = JSON.stringify(capture) !== JSON.stringify(saved)
  useRegisterUnsavedChanges('instant-quote', isDirty)

  const figures = useMemo(() => instantQuoteFigures(capture), [capture])
  const title = instantQuoteTitle(capture)
  const startLabel = instantQuoteStartLabel(capture.earliest_start)
  const hasWording = Boolean(
    capture.presentation.trim() || capture.scope_of_work.trim()
    || capture.job_inclusions.trim() || capture.job_exclusions.trim() || capture.job_assumptions.trim(),
  )
  const canDraft = capture.services.length > 0 && capture.brief.trim().length >= INSTANT_QUOTE_BRIEF_MIN_CHARS

  function patch(next: Partial<InstantQuoteCapture>) {
    setCapture(prev => ({ ...prev, ...next }))
  }

  function toggleService(id: InstantQuoteService, on: boolean) {
    const chosen = on ? [...capture.services, id] : capture.services.filter(service => service !== id)
    // Kept in the fixed order, so the title reads the same however they were ticked.
    patch({ services: INSTANT_QUOTE_SERVICES.map(service => service.id).filter(service => chosen.includes(service)) })
  }

  async function draftWording() {
    if (hasWording && !window.confirm('Replace the wording below with a new draft?')) return
    setDrafting(true)
    setError('')
    setDropped([])
    try {
      const res = await fetch(`/api/jobs/${job.id}/instant-quote-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capture }),
      })
      const data = (await res.json().catch(() => ({}))) as { draft?: InstantQuoteDraft; error?: string }
      if (!res.ok || !data.draft) throw new Error(data.error || `The wording could not be drafted (${res.status})`)
      const { dropped: left, ...wording } = data.draft
      patch(wording)
      setDropped(left)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The wording could not be drafted')
    } finally {
      setDrafting(false)
    }
  }

  async function save(): Promise<boolean> {
    setSaving(true)
    setError('')
    try {
      const merged = mergeAssessmentData(job.assessment_data)
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: { ...merged, instant_quote: capture } }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !data.job) throw new Error(data.error || `Save failed (${res.status})`)
      onJobUpdate(data.job)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function saveAndCompose() {
    const problems = instantQuoteProblems(capture)
    if (problems.length) {
      setError(problems.join(' '))
      return
    }
    const ok = await save()
    if (ok) router.push(`/jobs/${job.id}/docs/instant_quote?compose=1`)
  }

  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        marginBottom: 16,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
        Fast Quote
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 14 }}>
        One fixed price, quoted without a site inspection, from what the client reported. The quote says so at the top and in its assumptions. Nothing is remeasured afterwards, so the scope, the exclusions and the assumptions are what the price covers. You type the price. The wording is a draft for you to check.
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={LABEL}>This quote is for</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px' }}>
          {INSTANT_QUOTE_SERVICES.map(service => (
            <label key={service.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={capture.services.includes(service.id)}
                onChange={e => toggleService(service.id, e.target.checked)}
              />
              {service.label}
            </label>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 12, maxWidth: 480 }}>
        <label style={LABEL}>Title on the quote</label>
        <input
          value={capture.custom_title}
          onChange={e => patch({ custom_title: e.target.value })}
          placeholder={instantQuoteTitle({ services: capture.services, custom_title: '' })}
          style={INPUT}
        />
        <div style={HINT}>Leave blank to use the services ticked above.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 14 }}>
          <div style={LABEL}>Client</div>
          <div>{job.client_name || '—'}</div>
        </div>
        <div>
          <label style={LABEL}>Job address</label>
          <input
            value={capture.job_address ?? job.site_address ?? ''}
            onChange={e => patch({ job_address: e.target.value })}
            style={INPUT}
          />
        </div>
      </div>

      <div style={SECTION}>
        <label style={LABEL}>What the client reported</label>
        <textarea
          value={capture.brief}
          onChange={e => patch({ brief: e.target.value })}
          rows={4}
          placeholder="Two-bedroom unit, deceased estate. Clear all furniture and belongings from both bedrooms, living room and kitchen. Garage is not included. Then clean floors, walls, kitchen and bathroom. Photos sent by the daughter."
          style={TEXTAREA}
        />
        <CaptureFieldToolbar jobId={job.id} text={capture.brief} onTextChange={brief => patch({ brief })} polishBusy={drafting} />
        <div style={HINT}>
          For you and the draft only. It is not printed. Type or dictate what the client told you: the rooms or areas, what is there, and what they want done. Anything you leave out is treated as not included.
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <button type="button" className="btn btn-primary" onClick={() => void draftWording()} disabled={drafting || !canDraft}>
            {drafting ? 'Drafting…' : hasWording ? 'Draft the wording again' : 'Draft the wording'}
          </button>
          {!canDraft && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tick a service and write down what the client reported first.</span>
          )}
        </div>
        {dropped.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Left out of the draft</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              {dropped.map((item, i) => (
                <li key={`${i}:${item.line}`}>{item.line} <em>({INSTANT_DRAFT_DROP_LABELS[item.reason]})</em></li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div style={SECTION}>
        <div style={LABEL}>Photos the client supplied</div>
        <div style={{ ...HINT, marginTop: 0, marginBottom: 8 }}>
          Optional. Only photos the client sent, by text or email. They print on the quote under &ldquo;{INSTANT_QUOTE_SCHEMA.photosHeading}&rdquo;. The wording draft does not read them.
        </div>
        <SelectedPhotos
          jobId={job.id}
          title="Fast Quote"
          heading={false}
          photos={photos}
          ids={capture.photo_ids ?? []}
          onChange={ids => patch({ photo_ids: ids })}
          onPhotosUpdate={onPhotosUpdate}
          usedIds={usedIds}
          emptyText="No client photos on this quote."
        />
      </div>

      <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
        <div>
          <label style={LABEL}>Presentation</label>
          <textarea
            value={capture.presentation}
            onChange={e => patch({ presentation: e.target.value })}
            rows={3}
            placeholder="What the job is, as the client reported it. A blank field stays off the quote."
            style={TEXTAREA}
          />
        </div>
        <div>
          <label style={LABEL}>Scope of work</label>
          <textarea
            value={capture.scope_of_work}
            onChange={e => patch({ scope_of_work: e.target.value })}
            rows={Math.max(6, instantQuoteLines(capture.scope_of_work).length + 2)}
            placeholder="One step per line. The fixed price covers these steps and nothing else."
            style={TEXTAREA}
          />
          <div style={HINT}>One step per line. Each prints as a dot point.</div>
        </div>
      </div>

      {([
        ['job_inclusions', 'Inclusions', instantQuoteStandardInclusions(capture.services)],
        ['job_exclusions', 'Exclusions', instantQuoteStandardExclusions(capture.services)],
        ['job_assumptions', 'Assumptions', instantQuoteStandardAssumptions()],
      ] as const).map(([key, label, standard]) => (
        <div key={key} style={SECTION}>
          <div style={LABEL}>{label}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Printed on every fast quote:</div>
          <StandardLines lines={standard} />
          <label style={{ ...LABEL, marginTop: 10 }}>{label} for this job</label>
          <textarea
            value={capture[key]}
            onChange={e => patch({ [key]: e.target.value })}
            rows={Math.max(3, instantQuoteLines(capture[key]).length + 1)}
            placeholder="One item per line. Printed after the lines above."
            style={TEXTAREA}
          />
        </div>
      ))}

      <div style={SECTION}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label style={LABEL}>Fixed price ($)</label>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={capture.price ?? ''}
              onChange={e => patch({ price: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="0.00"
              style={INPUT}
            />
          </div>
          <div>
            <label style={LABEL}>The price typed is</label>
            <select
              value={capture.price_includes_gst ? 'inc' : 'ex'}
              onChange={e => patch({ price_includes_gst: e.target.value === 'inc' })}
              style={INPUT}
            >
              <option value="inc">Including GST</option>
              <option value="ex">Excluding GST</option>
            </select>
          </div>
          <div>
            <label style={LABEL}>Earliest start</label>
            <input
              type="date"
              value={capture.earliest_start}
              onChange={e => patch({ earliest_start: e.target.value })}
              style={INPUT}
            />
          </div>
        </div>
        <div style={HINT}>
          {startLabel
            ? `Prints as "${startLabel}". ${INSTANT_QUOTE_SCHEMA.startNote}`
            : 'Leave the earliest start blank to keep it off the quote.'}
        </div>
        <div style={{ marginTop: 12, display: 'grid', gap: 6, fontSize: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>{title}</span>
            <span>{formatAud(figures.subtotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>GST (10%)</span>
            <span>{formatAud(figures.gst)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: 800, marginTop: 4 }}>
            <span>Fixed price (inc GST)</span>
            <span>{formatAud(figures.total)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: 'var(--text-muted)', fontSize: 13 }}>
            <span>Deposit (50%) / balance</span>
            <span>{formatAud(figures.deposit)} / {formatAud(figures.balance)}</span>
          </div>
        </div>
      </div>

      <div style={{ ...HINT, marginTop: 14 }}>
        The quote also prints the payment terms and the company engagement agreement, the same agreement as the other quotes. After you generate and save it, send it for signing from the Documents tab.
      </div>
      {error && <div style={{ color: 'var(--danger, #f87171)', fontSize: 13, marginTop: 10 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="button" className="btn" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void saveAndCompose()} disabled={saving}>
          Generate quote
        </button>
      </div>
    </div>
  )
}
