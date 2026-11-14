/*
 * Send a saved Statement of Accounts to the client as a statement pack
 * (lib/documentPack.ts): one private link that opens on the statement, which
 * links on to the Contents Disposal Record and report ticked here. Each
 * document can be downloaded as a PDF. Nothing is signed.
 *
 *   useJobPacks             the packs sent on a job
 *   SendStatementPackModal  the send window: tick what goes with the statement,
 *                           then Link and passcode (a message to paste into your
 *                           own text or email) or Email from here (the brand address)
 *   PackStatus              the lines under the statement: sent, opened, expires,
 *                           the passcode, and Cancel link
 *
 * A person decides what goes to the client and sends it
 * (docs/ai-product-principles.md); the message to paste is fixed wording.
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

export interface PackSummary {
  id: string
  document_id: string | null
  status: 'sent' | 'viewed' | 'voided'
  to_name: string
  to_email: string | null
  delivery_method: 'email' | 'link'
  passcode: string | null
  passcode_locked_at: string | null
  sent_at: string
  sent_by_name: string | null
  expires_at: string
  first_viewed_at: string | null
  last_viewed_at: string | null
  voided_at: string | null
  items: { position: number; document_title: string; reference: string | null }[]
}

interface Candidate {
  id: string
  type: string
  title: string
  reference: string | null
  created_at: string
}

interface Preview {
  statement: Candidate
  candidates: Candidate[]
  maxExtras: number
  blockers: string[]
  warnings: string[]
  sender: { brandLabel: string; from: string; replyTo: string | null; usesBrandAddress: boolean } | null
  defaults: { toEmail: string; toName: string; subject: string; message: string }
  linkHost: string | null
  pendingLinkHost: string | null
  packs: PackSummary[]
}

interface CreatedLink {
  url: string
  host: string
  pendingHost: string | null
  passcode: string
  message: string
}

const CHANGED = 'bh-packs-changed'

/** The statement packs on a job. Pass null to skip (rows that are not statements). */
export function useJobPacks(jobId: string | null) {
  const [packs, setPacks] = useState<PackSummary[]>([])

  const reload = useCallback(() => {
    if (jobId) window.dispatchEvent(new CustomEvent(CHANGED, { detail: jobId }))
  }, [jobId])

  useEffect(() => {
    if (!jobId) return
    let live = true
    const load = () => {
      fetch(`/api/document-packs?jobId=${encodeURIComponent(jobId)}`)
        .then(res => (res.ok ? res.json() : { packs: [] }))
        .then((data: { packs?: PackSummary[] }) => { if (live) setPacks(data.packs ?? []) })
        .catch(() => {})
    }
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === jobId) load()
    }
    load()
    window.addEventListener('focus', load)
    window.addEventListener(CHANGED, onChanged)
    return () => {
      live = false
      window.removeEventListener('focus', load)
      window.removeEventListener(CHANGED, onChanged)
    }
  }, [jobId])

  return { packs, reload }
}

function when(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function itemName(i: { document_title?: string; title?: string; reference: string | null }): string {
  return `${i.document_title ?? i.title ?? ''}${i.reference ? ` ${i.reference}` : ''}`
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
// The app styles every label as a small upper-case heading; these are lines to read.
const lineLabel: CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0', margin: 0,
  fontSize: 13, fontWeight: 400, letterSpacing: 'normal', textTransform: 'none', lineHeight: 1.45, color: 'var(--text)',
}

type Mode = 'link' | 'email'

/** The newest CDR and the newest report start ticked; staff change it as they like. */
function startingPicks(candidates: Candidate[]): string[] {
  const picks: string[] = []
  for (const type of ['waste_disposal_manifest', 'report']) {
    const newest = candidates.find(c => c.type === type)
    if (newest) picks.push(newest.id)
  }
  return picks
}

export function SendStatementPackModal({ documentId, onClose, onSent }: {
  documentId: string
  onClose: () => void
  onSent: () => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadError, setLoadError] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [mode, setMode] = useState<Mode>('link')
  const [toName, setToName] = useState('')
  const [toEmail, setToEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<CreatedLink | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    let live = true
    fetch(`/api/document-packs?documentId=${encodeURIComponent(documentId)}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(res.status === 403 ? 'Only staff who see job money can send statements.' : data?.error ?? 'Could not load')
        return data as Preview
      })
      .then(data => {
        if (!live) return
        setPreview(data)
        setPicked(startingPicks(data.candidates))
        setToName(data.defaults.toName)
        setToEmail(data.defaults.toEmail)
        setSubject(data.defaults.subject)
        setMessage(data.defaults.message)
      })
      .catch(err => { if (live) setLoadError(err instanceof Error ? err.message : 'Could not load') })
    return () => { live = false }
  }, [documentId])

  const close = created ? onSent : onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, sending])

  const blocked = !preview || preview.blockers.length > 0 || !preview.sender
  const emailTyped = toEmail.trim()
  const emailOk = /^\S+@\S+\.\S+$/.test(emailTyped)
  const ready = !blocked && toName.trim().length >= 2 && (
    mode === 'link' ? !emailTyped || emailOk : emailOk && Boolean(subject.trim()) && Boolean(message.trim())
  )
  const maxExtras = preview?.maxExtras ?? 6
  const waiting = (preview?.packs ?? []).filter(p => p.document_id === documentId && p.status !== 'voided' && new Date(p.expires_at) > new Date())

  async function submit() {
    if (!ready || sending || !preview) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/document-packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode, statementId: documentId, documentIds: picked, toName, toEmail,
          ...(mode === 'email' ? { subject, message } : {}),
        }),
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
      aria-labelledby="send-pack-title"
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
            <div id="send-pack-title" style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>
              {created ? 'Link and passcode ready' : 'Send statement to client'}
            </div>
            {preview && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{itemName(preview.statement)}</div>}
          </div>
          <button type="button" onClick={close} disabled={sending} aria-label="Close"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}>
            ✕
          </button>
        </div>

        {loadError && <div role="alert" style={{ fontSize: 13, color: '#F87171' }}>{loadError}</div>}
        {!preview && !loadError && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>}

        {created && (
          <>
            <div style={{ ...helpText, color: 'var(--text)', marginBottom: 12 }}>
              Nothing has been sent. Copy the message into a text or an email and send it yourself. You can edit it here first.
            </div>
            <label htmlFor="ssp-paste" style={fieldLabel}>Message to send</label>
            <textarea
              id="ssp-paste"
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
              <div>The passcode stays under the statement in Documents, so you can repeat it to the client.</div>
              {created.pendingHost && (
                <div style={{ color: '#FBBF24' }}>{created.pendingHost} is not connected yet, so this link opens on {created.host}.</div>
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
            {(preview.warnings ?? []).length > 0 && (
              <div style={{ fontSize: 13, color: '#FBBF24', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, lineHeight: 1.5 }}>
                {preview.warnings.map(w => <div key={w}>{w}</div>)}
              </div>
            )}

            <div style={{ ...helpText, marginBottom: 12 }}>
              The link opens on the statement. A bar at the top links to the other documents ticked below, and downloads each as a PDF. The link can be used for 28 days.
            </div>

            <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', margin: '0 0 14px' }}>
              <legend style={{ ...fieldLabel, marginBottom: 0, padding: '0 4px' }}>In the pack</legend>
              <label style={{ ...lineLabel, cursor: 'default' }}>
                <input type="checkbox" checked disabled style={{ marginTop: 3 }} />
                <span><span style={{ fontWeight: 600 }}>{itemName(preview.statement)}</span><span style={{ color: 'var(--text-muted)' }}> · opens first</span></span>
              </label>
              {preview.candidates.map(c => {
                const ticked = picked.includes(c.id)
                const full = !ticked && picked.length >= maxExtras
                return (
                  <label key={c.id} style={{ ...lineLabel, cursor: full ? 'default' : 'pointer', opacity: full ? 0.5 : 1 }}>
                    <input
                      type="checkbox" checked={ticked} disabled={full || sending} style={{ marginTop: 3 }}
                      onChange={e => setPicked(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))}
                    />
                    <span>
                      <span style={{ fontWeight: 600 }}>{itemName(c)}</span>
                      <span style={{ color: 'var(--text-muted)' }}> · saved {when(c.created_at)}</span>
                    </span>
                  </label>
                )
              })}
              {preview.candidates.length === 0 && (
                <div style={{ ...helpText, marginTop: 4 }}>This job has no saved Contents Disposal Record or report, so the statement goes on its own.</div>
              )}
              <div style={{ ...helpText, marginTop: 6 }}>Each document goes as it is saved right now; changes made afterwards are not included.</div>
            </fieldset>

            {waiting.length > 0 && (
              <div style={{ ...helpText, color: '#FBBF24', marginBottom: 12 }}>
                This statement already has an open link (sent {day(waiting[0].sent_at)}). It keeps working until it expires or you cancel it.
              </div>
            )}

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
                  {' '}An emailed link has no passcode, the same as emailed quotes.
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ flex: '1 1 180px' }}>
                <label htmlFor="ssp-name" style={fieldLabel}>Client name</label>
                <input id="ssp-name" style={fieldInput} value={toName} onChange={e => setToName(e.target.value)} maxLength={120} autoComplete="off" />
              </div>
              <div style={{ flex: '1 1 220px' }}>
                <label htmlFor="ssp-email" style={fieldLabel}>{mode === 'link' ? 'Client email (optional)' : 'Client email'}</label>
                <input id="ssp-email" type="email" style={fieldInput} value={toEmail} onChange={e => setToEmail(e.target.value)} autoComplete="off" />
              </div>
            </div>

            {mode === 'email' && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label htmlFor="ssp-subject" style={fieldLabel}>Subject</label>
                  <input id="ssp-subject" style={fieldInput} value={subject} onChange={e => setSubject(e.target.value)} maxLength={200} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label htmlFor="ssp-message" style={fieldLabel}>Message</label>
                  <textarea id="ssp-message" style={{ ...fieldInput, minHeight: 150, resize: 'vertical', lineHeight: 1.5 }}
                    value={message} onChange={e => setMessage(e.target.value)} maxLength={4000} />
                  <div style={{ ...helpText, marginTop: 6 }}>A View document button with the link goes under your message.</div>
                </div>
              </>
            )}

            {error && <div role="alert" style={{ fontSize: 13, color: '#F87171', marginBottom: 10 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={close} disabled={sending} style={{ fontSize: 13, padding: '9px 16px' }}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={!ready || sending} style={{ fontSize: 13, padding: '9px 18px' }}>
                {sending ? (mode === 'link' ? 'Creating…' : 'Sending…') : mode === 'link' ? 'Create link and passcode' : 'Send email'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** The packs sent from this statement, newest first. Cancelled and expired links are kept short. */
export function PackStatus({ packs, documentId, onChanged }: {
  packs: PackSummary[]
  documentId: string
  onChanged: () => void
}) {
  const [cancelling, setCancelling] = useState('')
  const [error, setError] = useState('')
  const mine = packs.filter(p => p.document_id === documentId)
  if (!mine.length) return null

  async function cancel(id: string) {
    setCancelling(id)
    setError('')
    try {
      const res = await fetch(`/api/document-packs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'void' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Could not cancel the link')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the link')
    } finally {
      setCancelling('')
    }
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'grid', gap: 8 }}>
      {mine.slice(0, 5).map(p => {
        const expired = new Date(p.expires_at) <= new Date()
        const open = p.status !== 'voided' && !expired && !p.passcode_locked_at
        const state = p.status === 'voided'
          ? `cancelled ${when(p.voided_at)}`
          : p.passcode_locked_at ? 'locked: too many wrong passcodes'
          : expired ? `expired ${day(p.expires_at)}`
          : p.first_viewed_at ? `opened ${when(p.first_viewed_at)}${p.last_viewed_at && p.last_viewed_at !== p.first_viewed_at ? `, last ${when(p.last_viewed_at)}` : ''}`
          : 'not opened yet'
        return (
          <div key={p.id} style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, opacity: open ? 1 : 0.7 }}>
            <div style={{ color: 'var(--text)' }}>
              <strong>Statement pack</strong> {p.delivery_method === 'email' ? `emailed to ${p.to_email}` : `link for ${p.to_name}`}
              {' '}· {when(p.sent_at)}{p.sent_by_name ? ` by ${p.sent_by_name}` : ''} · {state}
            </div>
            {open && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <span>Can be opened until {day(p.expires_at)}</span>
                {p.passcode && <span>Passcode <span style={{ ...codeText, color: 'var(--text)' }}>{p.passcode}</span></span>}
                <button type="button" onClick={() => cancel(p.id)} disabled={cancelling === p.id}
                  style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
                  {cancelling === p.id ? '…' : 'Cancel link'}
                </button>
              </div>
            )}
            {p.items.length > 0 && <div>In it: {p.items.map(itemName).join(', ')}</div>}
          </div>
        )
      })}
      {error && <div role="alert" style={{ fontSize: 12, color: '#F87171' }}>{error}</div>}
    </div>
  )
}
