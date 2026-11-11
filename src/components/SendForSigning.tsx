/*
 * Send a saved quote to the client, and show where it is up to. The client's
 * link is a funnel: they view the quote, sign it on the same page, then see the
 * deposit to pay.
 *
 *   useJobSigning        the requests on a job, and where the job's Xero invoice
 *                        is up to (one fetch shared by every row)
 *   SendForSigningModal  the send window, with two ways to get the quote to the client:
 *                          Link and passcode  creates a private link, a passcode and a
 *                                             message to paste into your own text or email
 *                          Email from here    the system emails the link from the brand address
 *                        and the deposit the client is asked to pay after signing
 *   SigningStatus        the strip under a saved quote: link created / sent / opened /
 *                        signed / declined, then the deposit and what to do in Xero
 *
 * The From address is decided on the server from the job's trading name and is
 * only shown here. Either way a person decides what goes to the client
 * (docs/ai-product-principles.md); nothing is sent without that, and the
 * message to paste is fixed wording, not AI.
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

export interface SigningSummary {
  id: string
  job_id: string
  document_id: string | null
  status: 'sent' | 'viewed' | 'signed' | 'declined' | 'voided'
  document_title: string
  reference: string | null
  brand_label: string
  from_address: string
  reply_to: string | null
  /** Null when staff sent the link themselves and gave no email. */
  to_email: string | null
  to_name: string
  sent_at: string
  sent_by_name: string | null
  expires_at: string
  first_viewed_at: string | null
  signed_at: string | null
  signer_name: string | null
  declined_at: string | null
  decline_reason: string | null
  voided_at: string | null
  delivered_at: string | null
  delivery_error: string | null
  /** email = the system emailed the link. link = staff sent the link and passcode themselves. */
  delivery_method: 'email' | 'link'
  passcode: string | null
  passcode_locked_at: string | null
  /** Inc GST. Null for staff who are not shown money. */
  quote_total: number | null
  /** Share of the total asked for after signing. Null = no pay step. */
  deposit_percent: number | null
}

/** Where the job's Xero invoice is up to, for a signed quote with a deposit. */
export interface SigningInvoice {
  xeroConnected: boolean
  number: string
  /** Xero's status: DRAFT, SUBMITTED, AUTHORISED, PAID, VOIDED, DELETED. Empty when there is no invoice yet. */
  status: string
  amountPaid: number
  paidOn: string | null
  payLinkLive: boolean
  xeroUrl: string | null
}

interface JobSigning {
  requests: SigningSummary[]
  invoice: SigningInvoice | null
}

interface Preview {
  title: string
  reference: string | null
  blockers: string[]
  sender: { brandLabel: string; from: string; replyTo: string | null; usesBrandAddress: boolean } | null
  defaults: { toEmail: string; toName: string; subject: string; message: string }
  requests: SigningSummary[]
  /** The brand's document host when links will open there. */
  linkHost: string | null
  /** The brand's document host when it is not connected yet. */
  pendingLinkHost: string | null
  /** Quote total inc GST. Null for staff who are not shown money. */
  total: number | null
  hasTotal: boolean
  defaultDepositPercent: number
  bankDetailsSet: boolean
  xeroConnected: boolean
}

interface CreatedLink {
  url: string
  host: string
  pendingHost: string | null
  passcode: string
  message: string
}

// Every saved-quote row on a job asks for the same list; share one request.
const inFlight = new Map<string, Promise<JobSigning>>()
const NOTHING: JobSigning = { requests: [], invoice: null }

function loadJobSigning(jobId: string): Promise<JobSigning> {
  let pending = inFlight.get(jobId)
  if (!pending) {
    pending = fetch(`/api/signing?jobId=${encodeURIComponent(jobId)}`)
      .then(res => (res.ok ? res.json() : NOTHING))
      .then((data: Partial<JobSigning>) => ({ requests: data.requests ?? [], invoice: data.invoice ?? null }))
      .catch(() => NOTHING)
      .finally(() => inFlight.delete(jobId))
    inFlight.set(jobId, pending)
  }
  return pending
}

/** Signing requests for a job, with its Xero invoice status. Pass null to skip (rows that are not quotes). */
export function useJobSigning(jobId: string | null) {
  const [state, setState] = useState<JobSigning>(NOTHING)

  const reload = useCallback(async () => {
    if (!jobId) return
    setState(await loadJobSigning(jobId))
  }, [jobId])

  useEffect(() => {
    if (!jobId) return
    let live = true
    const load = () => {
      void loadJobSigning(jobId).then(next => {
        if (live) setState(next)
      })
    }
    load()
    // The client signs and pays somewhere else; pick it up when staff come back to the tab.
    window.addEventListener('focus', load)
    return () => {
      live = false
      window.removeEventListener('focus', load)
    }
  }, [jobId])

  return { requests: state.requests, invoice: state.invoice, reload }
}

/** The request that matters for a document: the newest one that was not cancelled, else the newest. */
export function currentSigning(requests: SigningSummary[], documentId: string): SigningSummary | null {
  const mine = requests.filter(r => r.document_id === documentId)
  return mine.find(r => r.status !== 'voided') ?? mine[0] ?? null
}

function when(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

function money(n: number): string {
  return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Same sum as the server (lib/signing/pay.ts): a share of the inc-GST total, to the cent. */
function depositOf(total: number | null, percent: number | null): number | null {
  if (total == null || percent == null || !(total > 0) || !(percent > 0)) return null
  return Math.round(total * percent) / 100
}

/** What is typed in the deposit box: a percentage, empty for none, or not valid. */
function readDeposit(text: string): { ok: boolean; percent: number | null } {
  const t = text.trim()
  if (!t) return { ok: true, percent: null }
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, percent: null }
  return { ok: true, percent: n > 0 ? Math.round(n * 100) / 100 : null }
}

const fieldLabel: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
  color: 'var(--text-muted)', marginBottom: 6,
}
const fieldInput: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14,
}
const helpText: CSSProperties = { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }
const codeText: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700, letterSpacing: '0.18em',
}

type Mode = 'link' | 'email'

export function SendForSigningModal({ documentId, onClose, onSent }: {
  documentId: string
  onClose: () => void
  /** Something was created or sent: the list under the quote should reload. */
  onSent: () => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadError, setLoadError] = useState('')
  const [mode, setMode] = useState<Mode>('link')
  const [toName, setToName] = useState('')
  const [toEmail, setToEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [depositText, setDepositText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<CreatedLink | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    let live = true
    fetch(`/api/signing?documentId=${encodeURIComponent(documentId)}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? 'Could not load')
        return data as Preview
      })
      .then(data => {
        if (!live) return
        setPreview(data)
        setToName(data.defaults.toName)
        setToEmail(data.defaults.toEmail)
        setSubject(data.defaults.subject)
        setMessage(data.defaults.message)
        setDepositText(data.hasTotal ? String(data.defaultDepositPercent) : '')
      })
      .catch(err => {
        if (live) setLoadError(err instanceof Error ? err.message : 'Could not load')
      })
    return () => { live = false }
  }, [documentId])

  // Once a link exists, closing by any route must still refresh the quote's status.
  const close = created ? onSent : onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sending) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, sending])

  const waiting = preview?.requests.find(r => r.status === 'sent' || r.status === 'viewed') ?? null
  const blocked = !preview || preview.blockers.length > 0 || !preview.sender
  const emailTyped = toEmail.trim()
  const emailOk = /^\S+@\S+\.\S+$/.test(emailTyped)
  const nameOk = toName.trim().length >= 2
  const depositChoice = readDeposit(depositText)
  const depositDue = depositOf(preview?.total ?? null, depositChoice.percent)
  const ready = !blocked && nameOk && depositChoice.ok && (
    mode === 'link'
      ? !emailTyped || emailOk
      : emailOk && Boolean(subject.trim()) && Boolean(message.trim())
  )

  async function submit() {
    if (!ready || sending) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/signing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'link'
            ? { mode, documentId, toName, toEmail, depositPercent: depositChoice.percent }
            : { mode, documentId, toName, toEmail, subject, message, depositPercent: depositChoice.percent },
        ),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'That did not work')
      if (mode === 'link') {
        if (!data.link) throw new Error('The link was not returned. Please try again.')
        setCreated(data.link as CreatedLink)
        setPasteText((data.link as CreatedLink).message)
        setSending(false)
      } else {
        onSent()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work')
      setSending(false)
    }
  }

  function copy(what: string, text: string) {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(what)
        setTimeout(() => setCopied(current => (current === what ? '' : current)), 2000)
      },
      () => setCopied('failed'),
    )
  }

  const docLine = preview ? `${preview.title}${preview.reference ? ` ${preview.reference}` : ''}` : ''
  const tab = (value: Mode, label: string) => (
    <button
      type="button"
      onClick={() => { setMode(value); setError('') }}
      aria-pressed={mode === value}
      disabled={sending}
      style={{
        flex: 1, padding: '9px 10px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
        border: mode === value ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: mode === value ? 'rgba(255,107,53,0.12)' : 'transparent',
        color: 'var(--text)',
      }}
    >{label}</button>
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-signing-title"
      onClick={e => { if (e.target === e.currentTarget && !sending) close() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 220,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 16, padding: '22px 22px 18px', width: '100%', maxWidth: 560,
        maxHeight: '100%', overflowY: 'auto', border: '1px solid var(--border)', boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div>
            <div id="send-signing-title" style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>
              {created ? 'Link and passcode ready' : 'Send to client'}
            </div>
            {docLine && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{docLine}</div>}
          </div>
          <button type="button" onClick={close} disabled={sending} aria-label="Close"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}>
            ✕
          </button>
        </div>

        {loadError && <div role="alert" style={{ fontSize: 13, color: '#F87171' }}>{loadError}</div>}
        {!preview && !loadError && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Preparing the document…</div>}

        {created && (
          <>
            <div style={{ ...helpText, color: 'var(--text)', marginBottom: 12 }}>
              Nothing has been sent. Copy the message into a text or an email and send it yourself. You can edit it here first.
            </div>
            <label htmlFor="sfs-paste" style={fieldLabel}>Message to send</label>
            <textarea
              id="sfs-paste"
              style={{ ...fieldInput, minHeight: 170, resize: 'vertical', lineHeight: 1.5 }}
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0 14px' }}>
              <button type="button" className="btn btn-primary" style={{ fontSize: 13, padding: '9px 16px' }} onClick={() => copy('message', pasteText)}>
                {copied === 'message' ? '✓ Copied' : 'Copy message'}
              </button>
              <button type="button" className="btn btn-secondary" style={{ fontSize: 13, padding: '9px 14px' }} onClick={() => copy('link', created.url)}>
                {copied === 'link' ? '✓ Copied' : 'Copy link only'}
              </button>
              <button type="button" className="btn btn-secondary" style={{ fontSize: 13, padding: '9px 14px' }} onClick={() => copy('code', created.passcode)}>
                {copied === 'code' ? '✓ Copied' : 'Copy passcode only'}
              </button>
            </div>
            {copied === 'failed' && (
              <div role="alert" style={{ fontSize: 12, color: '#F87171', marginBottom: 10 }}>
                Could not copy. Select the message above and copy it by hand.
              </div>
            )}
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Passcode</div>
              <div style={{ ...codeText, fontSize: 24, color: 'var(--text)' }}>{created.passcode}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, wordBreak: 'break-all' }}>{created.url}</div>
            </div>
            <div style={{ ...helpText, marginBottom: 14 }}>
              <div>The link is shown this once and cannot be shown again. If it is lost, create a new one.</div>
              <div>The passcode stays on the quote in Documents, so you can repeat it to the client.</div>
              <div>For a sensitive job, send the link and the passcode separately, for example the link by email and the passcode by text.</div>
              {created.pendingHost && (
                <div style={{ color: '#FBBF24' }}>
                  {created.pendingHost} is not connected yet, so this link opens on {created.host}.
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={close} style={{ fontSize: 13, padding: '9px 18px' }}>Done</button>
            </div>
          </>
        )}

        {preview && !created && (
          <>
            {preview.blockers.length > 0 && (
              <div role="alert" style={{ fontSize: 13, color: '#F87171', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, lineHeight: 1.5 }}>
                {preview.blockers.map(b => <div key={b}>{b}</div>)}
              </div>
            )}

            <div style={{ ...helpText, marginBottom: 12 }}>
              The client views the quote first, signs it on the same page, then sees the deposit to pay.
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {tab('link', 'Link and passcode')}
              {tab('email', 'Email from here')}
            </div>

            {mode === 'link' && (
              <div style={{ ...helpText, marginBottom: 14 }}>
                Creates a private link and a 4-character passcode, with a message to paste into your own text or email. Nothing is sent from here.
                {preview.linkHost && <> The link opens on {preview.linkHost}.</>}
                {preview.pendingLinkHost && (
                  <span style={{ color: '#FBBF24' }}> {preview.pendingLinkHost} is not connected yet, so for now the link opens on the app address.</span>
                )}
              </div>
            )}

            {mode === 'email' && preview.sender && (
              <div style={{ marginBottom: 14 }}>
                <span style={fieldLabel}>From</span>
                <div style={{ fontSize: 14, color: 'var(--text)', wordBreak: 'break-word' }}>{preview.sender.from}</div>
                <div style={{ ...helpText, marginTop: 4 }}>
                  {!preview.sender.usesBrandAddress && (
                    <>Sent under the {preview.sender.brandLabel} name from the shared address, because {preview.sender.brandLabel} does not have its own sending address set up. </>
                  )}
                  {preview.sender.replyTo
                    ? <>Replies go to {preview.sender.replyTo}.</>
                    : <>No reply address is set: add an email in Settings so the client can reply.</>}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ flex: '1 1 180px' }}>
                <label htmlFor="sfs-name" style={fieldLabel}>Signer name</label>
                <input id="sfs-name" style={fieldInput} value={toName} onChange={e => setToName(e.target.value)} maxLength={120} autoComplete="off" />
              </div>
              <div style={{ flex: '1 1 220px' }}>
                <label htmlFor="sfs-email" style={fieldLabel}>{mode === 'link' ? 'Signer email (optional)' : 'Signer email'}</label>
                <input id="sfs-email" type="email" style={fieldInput} value={toEmail} onChange={e => setToEmail(e.target.value)} autoComplete="off" />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label htmlFor="sfs-deposit" style={fieldLabel}>Deposit to pay after signing</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input
                  id="sfs-deposit" inputMode="decimal" autoComplete="off" maxLength={6}
                  style={{ ...fieldInput, width: 84, textAlign: 'right' }}
                  value={depositText}
                  disabled={!preview.hasTotal}
                  onChange={e => setDepositText(e.target.value)}
                  aria-describedby="sfs-deposit-help"
                />
                <span style={{ fontSize: 14, color: 'var(--text)' }}>%</span>
                {depositDue != null && preview.total != null && (
                  <span style={{ fontSize: 14, color: 'var(--text)' }}>
                    = <strong>{money(depositDue)}</strong> of {money(preview.total)} inc GST
                  </span>
                )}
              </div>
              <div id="sfs-deposit-help" style={{ ...helpText, marginTop: 6 }}>
                {!preview.hasTotal ? (
                  <>This quote has no total, so the client is not asked for a deposit.</>
                ) : !depositChoice.ok ? (
                  <span style={{ color: '#F87171' }}>Enter a percentage between 1 and 100, or leave it empty for no deposit.</span>
                ) : depositChoice.percent == null ? (
                  <>No deposit: the client&apos;s page ends at the signed copy.</>
                ) : (
                  <>
                    After signing, the client&apos;s page shows this deposit{preview.bankDetailsSet ? ' with your bank details and the quote reference' : ''}.
                    {' '}Our quotes ask for {preview.defaultDepositPercent}%: if you change it, check the quote&apos;s payment terms say the same.
                    {' '}{preview.xeroConnected
                      ? 'Once it is signed, set the deposit request on the draft invoice in Xero and approve it; Pay by card then appears on their page.'
                      : 'Xero is not connected, so no invoice is created and there is no Pay by card.'}
                    {!preview.bankDetailsSet && (
                      <span style={{ color: '#FBBF24' }}> No bank details are saved in Settings, so the client will not see bank transfer details.</span>
                    )}
                  </>
                )}
              </div>
            </div>

            {mode === 'link' && (
              <div style={{ ...helpText, marginBottom: 14 }}>
                {emailTyped
                  ? 'Once signed, the signed PDF with its signature docket is emailed to this address, and the job moves to Accepted.'
                  : 'With no email, the client downloads their signed copy when they sign, the office inbox is emailed the PDF to pass on, and the job moves to Accepted.'}
                {' '}They sign the quote as it is saved right now; changes made afterwards are not included.
              </div>
            )}

            {mode === 'email' && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label htmlFor="sfs-subject" style={fieldLabel}>Subject</label>
                  <input id="sfs-subject" style={fieldInput} value={subject} onChange={e => setSubject(e.target.value)} maxLength={200} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label htmlFor="sfs-message" style={fieldLabel}>Message</label>
                  <textarea id="sfs-message" style={{ ...fieldInput, minHeight: 190, resize: 'vertical', lineHeight: 1.5 }} value={message} onChange={e => setMessage(e.target.value)} maxLength={4000} />
                </div>
                <div style={{ ...helpText, marginBottom: 14 }}>
                  The client gets a private link with a View document button under your message. They see and sign the quote as it is saved right now; changes made after sending are not included. Once signed, they are emailed the signed PDF with its signature docket, and the job moves to Accepted.
                </div>
              </>
            )}

            {waiting && (
              <div style={{ fontSize: 12, color: 'var(--text)', background: 'rgba(255,107,53,0.08)', border: '1px solid rgba(255,107,53,0.35)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, lineHeight: 1.5 }}>
                {waiting.delivery_method === 'link'
                  ? <>A link for this quote was already created on {when(waiting.sent_at)} and has not been signed. A new one replaces it, so the earlier link will stop working.</>
                  : <>This quote was already sent to {waiting.to_email} on {when(waiting.sent_at)} and has not been signed. A new one replaces that link, so the earlier email will stop working.</>}
              </div>
            )}

            {error && <div role="alert" style={{ fontSize: 13, color: '#F87171', marginBottom: 12, lineHeight: 1.5 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={close} disabled={sending} style={{ fontSize: 13, padding: '9px 16px' }}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={!ready || sending} style={{ fontSize: 13, padding: '9px 18px' }}>
                {mode === 'link'
                  ? sending ? 'Creating…' : 'Create link and passcode'
                  : sending ? 'Sending…' : 'Send email'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Where a saved quote's signing is up to, with the few things staff can do about it. */
export function SigningStatus({ request, invoice, onChanged }: {
  request: SigningSummary
  /** The job's Xero invoice, when a signed quote on the job has a deposit. */
  invoice: SigningInvoice | null
  onChanged: () => void
}) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)

  async function act(action: 'void' | 'resend' | 'deliver', done: string) {
    setBusy(action)
    setError('')
    setNote('')
    try {
      const res = await fetch(`/api/signing/${request.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'That did not work')
      setNote(done)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work')
    } finally {
      setBusy('')
      setConfirmCancel(false)
    }
  }

  const byLink = request.delivery_method === 'link'
  const waiting = request.status === 'sent' || request.status === 'viewed'
  const locked = Boolean(request.passcode_locked_at) && request.status !== 'voided'
  const who = request.to_email ?? request.to_name
  const small: CSSProperties = { fontSize: 11, padding: '5px 10px' }

  let label = ''
  let color = 'var(--text-muted)'
  let detail = ''
  if (request.status === 'sent') {
    label = byLink ? 'Link created' : 'Sent for signing'
    color = '#60A5FA'
    detail = byLink
      ? `for ${request.to_name} on ${when(request.sent_at)}. Not opened yet.`
      : `to ${request.to_email} on ${when(request.sent_at)}. Not opened yet.`
  }
  if (request.status === 'viewed') {
    label = 'Opened, not signed'
    color = '#FBBF24'
    detail = `by ${who} on ${when(request.first_viewed_at)}. ${byLink ? 'Link created' : 'Sent'} ${when(request.sent_at)}.`
  }
  if (request.status === 'signed') {
    label = 'Signed'
    color = '#34D399'
    detail = `by ${request.signer_name ?? request.to_name}${request.to_email ? ` (${request.to_email})` : ''} on ${when(request.signed_at)}.`
  }
  if (request.status === 'declined') {
    label = 'Declined'
    color = '#F87171'
    detail = `by ${who} on ${when(request.declined_at)}.${request.decline_reason ? ` "${request.decline_reason}"` : ''}`
  }
  if (request.status === 'voided') {
    label = 'Cancelled'
    detail = `on ${when(request.voided_at)}. Was for ${who}.`
  }
  if (locked) {
    label = 'Locked'
    color = '#F87171'
    detail = `The wrong passcode was entered five times, so the link for ${request.to_name} no longer opens. Use Send to client to create a new one.`
  }

  // After signing: the deposit the client was asked for, and what is next in Xero.
  const percent = request.status === 'signed' ? request.deposit_percent : null
  const due = depositOf(request.quote_total, percent)
  const asked = percent == null ? '' : due != null ? `${money(due)} (${percent}%)` : `${percent}%`
  const invoiceName = invoice?.number ? `invoice ${invoice.number}` : 'the invoice'
  let depositColor = 'var(--text)'
  let depositText = ''
  if (percent != null && invoice) {
    const received = invoice.amountPaid
    if (!invoice.xeroConnected) {
      depositText = `Deposit asked: ${asked}. Xero is not connected, so no invoice was created; the client's page shows bank details only.`
    } else if (invoice.status === 'VOIDED' || invoice.status === 'DELETED') {
      depositText = `Deposit asked: ${asked}. ${invoiceName[0].toUpperCase()}${invoiceName.slice(1)} was voided in Xero, so the client's page shows bank details only.`
    } else if (due != null && received >= due - 0.005) {
      depositColor = '#34D399'
      depositText = `Deposit received: ${money(received)} paid on ${invoiceName}${invoice.paidOn ? ` (${invoice.paidOn.split('-').reverse().join('/')})` : ''}. Asked for ${asked}.`
    } else if (invoice.status === 'PAID') {
      depositColor = '#34D399'
      depositText = `${invoiceName[0].toUpperCase()}${invoiceName.slice(1)} is paid in full.`
    } else if (!invoice.status || invoice.status === 'CLAIMED') {
      depositText = `Deposit asked: ${asked}. The Xero invoice has not been created yet.`
    } else if (invoice.status === 'AUTHORISED') {
      depositText = `Deposit asked: ${asked}. ${invoiceName[0].toUpperCase()}${invoiceName.slice(1)} is approved${invoice.payLinkLive ? ", and Pay by card is showing on the client's page" : ''}. ${received > 0.005 ? `${money(received)} received so far.` : 'Nothing received yet.'}`
    } else {
      depositColor = '#FBBF24'
      depositText = `Deposit asked: ${asked}. Next: in Xero, set the deposit request to ${percent}% on draft ${invoiceName} and approve it. Pay by card then appears on the client's page.`
    }
  } else if (percent != null) {
    depositText = `Deposit asked: ${asked}.`
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 999, padding: '1px 8px', fontSize: 11, whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <span style={{ color: 'var(--text)', flex: '1 1 200px' }}>{detail}</span>
        {waiting && (
          <>
            {!byLink && !locked && (
              <button type="button" className="btn btn-secondary" style={small} disabled={!!busy}
                onClick={() => act('resend', 'Sent again with a new link.')}>
                {busy === 'resend' ? 'Sending…' : 'Send again'}
              </button>
            )}
            {confirmCancel ? (
              <>
                <button type="button" style={{ ...small, borderRadius: 6, border: 'none', background: '#EF4444', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
                  disabled={!!busy} onClick={() => act('void', 'Cancelled. The link no longer works.')}>
                  {busy === 'void' ? '…' : 'Cancel request'}
                </button>
                <button type="button" className="btn btn-secondary" style={small} onClick={() => setConfirmCancel(false)}>Keep</button>
              </>
            ) : (
              <button type="button" className="btn btn-secondary" style={small} disabled={!!busy} onClick={() => setConfirmCancel(true)}>Cancel</button>
            )}
          </>
        )}
        {request.status === 'signed' && (
          <>
            <a href={`/api/signing/${request.id}/pdf`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ ...small, textDecoration: 'none' }}>
              Signed PDF
            </a>
            <button type="button" className="btn btn-secondary" style={small} disabled={!!busy}
              onClick={() => act('deliver', request.to_email ? 'Signed copy emailed.' : 'Signed copy emailed to the office.')}>
              {busy === 'deliver' ? 'Sending…' : request.to_email ? 'Email signed copy again' : 'Email signed copy to office'}
            </button>
          </>
        )}
      </div>
      <div style={{ color: 'var(--text-muted)', marginTop: 4, wordBreak: 'break-word' }}>
        {byLink ? (
          <>
            Link created{request.sent_by_name ? ` by ${request.sent_by_name}` : ''} to send yourself; not sent from here.
            {request.passcode && request.status !== 'voided' && (
              <> Passcode <span style={{ ...codeText, color: 'var(--text)' }}>{request.passcode}</span>.</>
            )}
          </>
        ) : (
          <>From {request.from_address}{request.sent_by_name ? `, sent by ${request.sent_by_name}` : ''}.</>
        )}
        {request.status === 'signed' && request.delivered_at && !request.delivery_error && ` Signed copy emailed ${when(request.delivered_at)}.`}
        {request.status === 'signed' && !request.delivered_at && !request.delivery_error && ' Signed copy is being emailed.'}
      </div>
      {request.status === 'signed' && request.delivery_error && (
        request.delivered_at ? (
          <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
            Signed copy emailed {when(request.delivered_at)}. {request.delivery_error}
          </div>
        ) : (
          <div role="alert" style={{ color: '#F87171', marginTop: 4 }}>
            The signed copy has not been emailed: {request.delivery_error}
          </div>
        )
      )}
      {depositText && (
        <div style={{ color: depositColor, marginTop: 4 }}>
          {depositText}
          {invoice?.xeroUrl && (
            <> <a href={invoice.xeroUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>Open in Xero</a></>
          )}
        </div>
      )}
      {note && <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{note}</div>}
      {error && <div role="alert" style={{ color: '#F87171', marginTop: 4 }}>{error}</div>}
    </div>
  )
}
