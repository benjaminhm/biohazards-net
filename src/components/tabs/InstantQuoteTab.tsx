'use client'

/*
 * Fast Quote (stored as `instant_quote`): one fixed price, quoted without a site inspection, for a scope
 * written from what the client reported. The only photos on it are ones the client supplied.
 *
 * Staff tick the services, type or dictate what the client reported, and type the price. "Draft the wording" asks the
 * model for the presentation, scope, inclusions, exclusions and assumptions; staff read and edit them here.
 * The price is only ever typed by staff.
 *
 * Two presses make a quote: "Draft the wording", then "Text quote to client", which saves the page, saves
 * the printed quote to Documents, makes the client's private link (opened with their mobile number) and shows
 * a QR. Scanning it opens Messages on staff's phone with the message and link filled in; staff tap send.
 * Nothing is sent from the app (docs/ai-product-principles.md).
 * "Generate quote" opens the standard document page instead, to read the quote before sending.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
import { emailMessageHandoff, handoffFitsQr, handoffQrSvg, textMessageHandoff } from '@/lib/phoneHandoff'
import { SendBrandSmsButton } from '@/components/SendBrandSms'
import PhoneHandoffButtons from '@/components/PhoneHandoffButtons'
import { isTradingNameId, tradingAuthReplyEmail, tradingSmsSenderId } from '@/lib/tradingNames'
import { DEFAULT_DEPOSIT_PERCENT } from '@/lib/signing/pay'
import { isPhonePasscode, phonePasscode, phonePasscodeLabel } from '@/lib/signing/phone'

interface Props {
  job: Job
  photos: Photo[]
  onJobUpdate: (job: Job) => void
  onPhotosUpdate: (photos: Photo[]) => void
}

const INPUT: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 44,
  fontSize: 16,
  padding: '10px 12px',
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

/** The client link just made. It is shown this once: only a hash of it is kept. */
interface ClientLink {
  url: string
  host: string
  pendingHost: string | null
  passcode: string
  message: string
}

/** The link ready to send: direct brand SMS (e.g. FCQ), native Gmail/Share on tablet, or QR handoff to phone. */
function LinkReady({ link, jobId, smsSenderId, replyEmail, phone, email, subject, onClose }: {
  link: ClientLink
  jobId: string
  smsSenderId: string | null
  replyEmail: string
  phone: string
  email: string
  subject: string
  onClose: () => void
}) {
  const [message, setMessage] = useState(link.message)
  const [copied, setCopied] = useState('')
  const byPhone = isPhonePasscode(link.passcode)
  const effectivePhone = byPhone ? link.passcode : phone
  const text = textMessageHandoff(effectivePhone, message)
  const mail = emailMessageHandoff(email, subject, message)
  const handoff = text ?? mail
  const qr = useMemo(
    () => (handoff && message.trim() && handoffFitsQr(handoff.url) ? `data:image/svg+xml;utf8,${encodeURIComponent(handoffQrSvg(handoff.url))}` : ''),
    [handoff, message],
  )

  function copy(what: string, value: string) {
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(what)
        setTimeout(() => setCopied(current => (current === what ? '' : current)), 2000)
      },
      () => setCopied('failed'),
    )
  }

  return (
    <div style={{ ...SECTION, borderColor: 'var(--accent)', display: 'grid', gap: 10 }}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>
        {smsSenderId
          ? `Link ready. Review the message and send via ${smsSenderId} SMS or copy it.`
          : 'Link ready. Nothing has been sent.'}
      </div>
      <textarea value={message} onChange={e => setMessage(e.target.value)} rows={7} style={TEXTAREA} aria-label="Message to send" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <SendBrandSmsButton
          jobId={jobId}
          senderId={smsSenderId}
          phone={effectivePhone}
          message={message}
          replyEmail={replyEmail}
        />
        <button type="button" className={smsSenderId ? 'btn btn-secondary' : 'btn btn-primary'} style={{ minHeight: 42 }} onClick={() => copy('message', message)}>
          {copied === 'message' ? '✓ Copied' : 'Copy message'}
        </button>
        <button type="button" className="btn btn-secondary" style={{ minHeight: 42 }} onClick={() => copy('link', link.url)}>
          {copied === 'link' ? '✓ Copied' : 'Copy link only'}
        </button>
        <PhoneHandoffButtons
          message={message}
          phone={effectivePhone}
          email={email}
          subject={subject}
        />
        <button type="button" className="btn btn-secondary" style={{ minHeight: 42 }} onClick={onClose}>Done</button>
      </div>
      {qr && handoff && !smsSenderId && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code for the message" width={190} height={190} style={{ borderRadius: 8, background: '#fff' }} />
          <div style={{ flex: '1 1 220px', fontSize: 13, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700 }}>Scan with your phone camera.</div>
            <div style={{ color: 'var(--text-muted)' }}>
              {text ? 'Messages' : 'Mail'} opens to {handoff.to} with the message filled in.
            </div>
            <a className="btn btn-secondary" href={handoff.url} style={{ display: 'inline-block', marginTop: 8, textDecoration: 'none', fontSize: 13 }}>
              On this device: open in {text ? 'Messages' : 'Mail'}
            </a>
          </div>
        </div>
      )}
      {copied === 'failed' && <div style={HINT}>Could not copy. Select the message and copy it by hand.</div>}
      <div style={HINT}>
        {byPhone
          ? <>The client opens the link by typing their mobile, {phonePasscodeLabel(link.passcode)}, so text it to that number. </>
          : <>The link opens with the passcode <strong>{link.passcode}</strong>, which is in the message. </>}
        They read the quote, accept and sign on their phone, then see the {DEFAULT_DEPOSIT_PERCENT}% deposit.
        {link.pendingHost && <> {link.pendingHost} is not connected yet, so the link opens on {link.host}.</>}
      </div>
    </div>
  )
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
  const [sending, setSending] = useState(false)
  const [link, setLink] = useState<ClientLink | null>(null)
  const [error, setError] = useState('')
  const [dropped, setDropped] = useState<InstantQuoteDraft['dropped']>([])
  const [editHeader, setEditHeader] = useState(false)
  const [showClauses, setShowClauses] = useState(false)
  const usedIds = useMemo(() => usedPhotoIds(job.assessment_data, photos), [job.assessment_data, photos])
  const loadedJobIdRef = useRef(job.id)
  const captureRef = useRef(capture)
  captureRef.current = capture
  const savingRef = useRef(false)
  const skipSyncForUpdatedAtRef = useRef<string | null>(null)

  const isDirty = JSON.stringify(capture) !== JSON.stringify(saved)
  useRegisterUnsavedChanges('instant-quote', isDirty)
  const dirtyRef = useRef(isDirty)
  dirtyRef.current = isDirty

  useEffect(() => {
    if (job.id !== loadedJobIdRef.current) {
      loadedJobIdRef.current = job.id
      skipSyncForUpdatedAtRef.current = null
      setCapture(savedCapture(job))
      return
    }
    if (skipSyncForUpdatedAtRef.current === job.updated_at) {
      skipSyncForUpdatedAtRef.current = null
      return
    }
    if (dirtyRef.current || savingRef.current) return
    setCapture(savedCapture(job))
    // Reload only when the saved job changes externally, never overwriting in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, job.updated_at])

  // Auto-save edits shortly after typing stops (prevents lost work on iPad/tablet)
  useEffect(() => {
    if (!isDirty || saving || drafting || sending) return
    const timer = setTimeout(() => {
      void save()
    }, 850)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, saving, drafting, sending, capture])

  const smsSenderId = isTradingNameId(job.trading_name) ? tradingSmsSenderId(job.trading_name) : null
  const replyEmail = tradingAuthReplyEmail(isTradingNameId(job.trading_name) ? job.trading_name : null)

  const figures = useMemo(() => instantQuoteFigures(capture), [capture])
  const title = instantQuoteTitle(capture)
  const startLabel = instantQuoteStartLabel(capture.earliest_start)
  const hasWording = Boolean(
    capture.presentation.trim() || capture.scope_of_work.trim()
    || capture.job_inclusions.trim() || capture.job_exclusions.trim() || capture.job_assumptions.trim(),
  )
  const canDraft = capture.services.length > 0 && capture.brief.trim().length >= INSTANT_QUOTE_BRIEF_MIN_CHARS
  const clientPhone = (job.client_phone ?? '').trim()
  const clientEmail = (job.client_email ?? '').trim()

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
    if (savingRef.current) return false
    const snapshot = captureRef.current
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      const merged = mergeAssessmentData(job.assessment_data)
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: { ...merged, instant_quote: snapshot } }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !data.job) throw new Error(data.error || `Save failed (${res.status})`)
      skipSyncForUpdatedAtRef.current = data.job.updated_at
      onJobUpdate(data.job)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      return false
    } finally {
      savingRef.current = false
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

  /** Saves the page and the printed quote, makes the client's private link, and shows the QR to text it. */
  async function sendToClient() {
    const problems = instantQuoteProblems(capture)
    if (problems.length) {
      setError(problems.join(' '))
      return
    }
    setSending(true)
    setLink(null)
    try {
      if (!(await save())) return
      const docRes = await fetch(`/api/jobs/${job.id}/instant-quote-document`, { method: 'POST' })
      const doc = (await docRes.json().catch(() => ({}))) as {
        documentId?: string
        waiting?: { sent_at: string; to_name: string } | null
        error?: string
      }
      if (!docRes.ok || !doc.documentId) throw new Error(doc.error || `Saving the quote failed (${docRes.status})`)
      if (doc.waiting) {
        const when = new Date(doc.waiting.sent_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
        if (!window.confirm(`A link to this quote made on ${when} has not been signed yet. A new link replaces it, and the earlier one stops working. Make a new link?`)) return
      }
      const res = await fetch('/api/signing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'link',
          documentIds: [doc.documentId],
          toName: (job.client_name ?? '').trim(),
          // A number that cannot open the link is left off, so the link opens with a passcode instead.
          toPhone: phonePasscode(clientPhone) ? clientPhone : '',
          toEmail: /^\S+@\S+\.\S+$/.test(clientEmail) ? clientEmail : '',
          depositPercent: DEFAULT_DEPOSIT_PERCENT,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { link?: ClientLink; error?: string }
      if (!res.ok || !data.link) throw new Error(data.error || `The link could not be made (${res.status})`)
      setLink(data.link)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The link could not be made')
    } finally {
      setSending(false)
    }
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

      <div style={{ marginBottom: 14 }}>
        <div style={LABEL}>This quote is for</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {INSTANT_QUOTE_SERVICES.map(service => {
            const checked = capture.services.includes(service.id)
            return (
              <label
                key={service.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  minHeight: 42,
                  padding: '0 12px',
                  borderRadius: 10,
                  border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
                  background: checked ? 'var(--accent-dim)' : 'var(--bg)',
                  color: checked ? 'var(--accent)' : 'var(--text)',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e => toggleService(service.id, e.target.checked)}
                  style={{ width: 17, height: 17 }}
                />
                {service.label}
              </label>
            )
          })}
        </div>
      </div>

      {/* Compact client / address / title summary bar (expand only if overriding) */}
      <div style={{ ...SECTION, marginTop: 0, marginBottom: 12, padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--text)', minWidth: 0 }}>
            <strong>{job.client_name || 'Client'}</strong>
            {' · '}
            <span style={{ color: 'var(--text-muted)' }}>{capture.job_address ?? job.site_address ?? 'No address'}</span>
            {capture.custom_title.trim() && (
              <span style={{ color: 'var(--accent)', marginLeft: 6 }}>· {capture.custom_title.trim()}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setEditHeader(e => !e)}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0, minHeight: 36, padding: '0 6px' }}
          >
            {editHeader ? 'Done' : 'Edit title / address'}
          </button>
        </div>
        {editHeader && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 10 }}>
            <div>
              <label style={LABEL}>Title on the quote (optional)</label>
              <input
                value={capture.custom_title}
                onChange={e => patch({ custom_title: e.target.value })}
                placeholder={instantQuoteTitle({ services: capture.services, custom_title: '' })}
                style={INPUT}
              />
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
        )}
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

      {/* Collapsible Standard + Job-specific Inclusions, Exclusions & Assumptions */}
      <div style={SECTION}>
        <button
          type="button"
          onClick={() => setShowClauses(s => !s)}
          aria-expanded={showClauses}
          style={{
            width: '100%',
            minHeight: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--text)',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span>
            {showClauses ? '▾ Inclusions, Exclusions & Assumptions' : '▸ Standard Inclusions, Exclusions & Assumptions (edit or add job notes)'}
            {!showClauses && (
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>
                {[
                  instantQuoteLines(capture.job_inclusions).length ? `+${instantQuoteLines(capture.job_inclusions).length} inc` : null,
                  instantQuoteLines(capture.job_exclusions).length ? `+${instantQuoteLines(capture.job_exclusions).length} exc` : null,
                  instantQuoteLines(capture.job_assumptions).length ? `+${instantQuoteLines(capture.job_assumptions).length} assump` : null,
                ].filter(Boolean).join(' · ') || 'Standard lines applied'}
              </span>
            )}
          </span>
        </button>
        {showClauses && (
          <div style={{ display: 'grid', gap: 14, marginTop: 12 }}>
            {([
              ['job_inclusions', 'Inclusions', instantQuoteStandardInclusions(capture.services)],
              ['job_exclusions', 'Exclusions', instantQuoteStandardExclusions(capture.services)],
              ['job_assumptions', 'Assumptions', instantQuoteStandardAssumptions()],
            ] as const).map(([key, label, standard]) => (
              <div key={key} style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
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
          </div>
        )}
      </div>

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

      {error && <div style={{ color: 'var(--danger, #f87171)', fontSize: 13, marginTop: 10 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" style={{ minHeight: 44, padding: '0 16px', fontSize: 14, fontWeight: 700 }} onClick={() => void sendToClient()} disabled={saving || sending}>
          {sending ? 'Making the link…' : smsSenderId ? `Send quote (${smsSenderId} SMS / Link)` : 'Text quote to client'}
        </button>
        <button type="button" className="btn btn-secondary" style={{ minHeight: 44, padding: '0 14px', fontSize: 14 }} onClick={() => void saveAndCompose()} disabled={saving || sending}>
          Preview / Generate PDF
        </button>
        <span style={{ fontSize: 12, fontWeight: 600, color: saving ? 'var(--text-muted)' : !isDirty ? '#10B981' : 'var(--text-muted)' }}>
          {saving ? 'Saving…' : isDirty ? 'Unsaved…' : 'Saved ✓'}
        </span>
      </div>
      {link && (
        <LinkReady
          link={link}
          jobId={job.id}
          smsSenderId={smsSenderId}
          replyEmail={replyEmail}
          phone={clientPhone}
          email={clientEmail}
          subject={`${title} ${figures.total ? formatAud(figures.total) : ''}`.trim()}
          onClose={() => setLink(null)}
        />
      )}
    </div>
  )
}
