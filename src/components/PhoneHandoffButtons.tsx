'use client'

/*
 * "Text from phone" and "Email from phone" beside Copy message on a Link ready
 * box (SendForSigning, SendStatementPack). Each shows a QR of the message in
 * the box as it reads now. Scanning it opens Messages or Mail on the phone,
 * addressed to the client with that message filled in. Nothing is sent from
 * here: the person taps send on their own phone.
 *
 * Inside the Android tablet APK, we also show direct native buttons ("Open in
 * Gmail" and "Share…") so staff can jump straight into the Gmail app on the
 * tablet with To, Subject and the edited message already pre-filled — while
 * keeping the phone QR available beside it.
 *
 * A button is left out when there is no mobile or no email to address it to.
 */
import { useEffect, useMemo, useState } from 'react'
import { emailMessageHandoff, handoffFitsQr, handoffQrSvg, textMessageHandoff } from '@/lib/phoneHandoff'
import {
  openNativeEmailCompose,
  openNativeShare,
  triggerNativeHaptic,
  useIsTabletApp,
} from '@/lib/tabletApp'

type Which = 'text' | 'email'

export default function PhoneHandoffButtons({ message, phone, email, subject }: {
  /** The message box, including edits. */
  message: string
  phone?: string | null
  email?: string | null
  /** Subject line for the email. */
  subject: string
}) {
  const [open, setOpen] = useState<Which | null>(null)
  const isTablet = useIsTabletApp()
  const text = textMessageHandoff(phone, message)
  const mail = emailMessageHandoff(email, subject, message)
  const link = open === 'text' ? text : open === 'email' ? mail : null
  const empty = !message.trim()
  const url = link && !empty && handoffFitsQr(link.url) ? link.url : ''
  const qr = useMemo(
    () => (url ? `data:image/svg+xml;utf8,${encodeURIComponent(handoffQrSvg(url))}` : ''),
    [url],
  )

  // Escape closes this panel only. The window behind holds a link shown once.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  function handleOpenGmail() {
    if (!mail || empty) return
    triggerNativeHaptic('confirm')
    const opened = openNativeEmailCompose(mail.to, subject.trim(), message)
    if (!opened) {
      // Fallback for older APK or browser: standard mailto link.
      window.location.href = mail.url
    }
  }

  function handleNativeShare() {
    if (empty) return
    triggerNativeHaptic('light')
    openNativeShare(subject.trim(), message)
  }

  if (!text && !mail && !isTablet) return null

  const button = (which: Which, label: string) => (
    <button type="button" className="btn btn-secondary" style={{ fontSize: 13, padding: '9px 14px' }} onClick={() => setOpen(which)}>
      {label}
    </button>
  )

  return (
    <>
      {isTablet && mail && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={empty}
          style={{ fontSize: 13, padding: '9px 14px' }}
          onClick={handleOpenGmail}
        >
          Open in Gmail
        </button>
      )}
      {isTablet && !empty && (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: 13, padding: '9px 14px' }}
          onClick={handleNativeShare}
        >
          Share…
        </button>
      )}
      {text && button('text', 'Text from phone')}
      {mail && button('email', isTablet ? 'Email QR (phone)' : 'Email from phone')}
      {open && link && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={open === 'text' ? 'Text from phone' : 'Email from phone'}
          onClick={e => { if (e.target === e.currentTarget) setOpen(null) }}
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div style={{ width: '100%', maxWidth: 380, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, display: 'grid', gap: 12, textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ flex: 1, textAlign: 'left', fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>
                {open === 'text' ? 'Text from phone' : 'Email from phone'}
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(null)} aria-label="Close" style={{ fontSize: 18, padding: '4px 10px' }}>×</button>
            </div>
            {qr ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="QR code for the message" width={300} height={300} style={{ margin: '0 auto', borderRadius: 8, background: '#fff' }} />
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', wordBreak: 'break-word' }}>
                  Opens {open === 'text' ? 'Messages' : 'Mail'} to {link.to}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Scan with your phone camera. The message is filled in as it reads in the box. Nothing is sent until you tap send on the phone.
                </div>
              </>
            ) : (
              <div role="alert" style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, padding: '24px 0' }}>
                {empty
                  ? 'The message box is empty. Type the message first.'
                  : 'This message is too long for a QR code. Shorten it, or use Copy message.'}
              </div>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(null)} style={{ fontSize: 13 }}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}
