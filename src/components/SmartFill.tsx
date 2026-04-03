/*
 * components/SmartFill.tsx
 *
 * Collapsible AI form-fill panel used on the new-job form (and potentially
 * other forms). Accepts freeform text — either typed/pasted or dictated via
 * the Web Speech API — and sends it to /api/extract, which uses Claude to
 * extract structured job fields from the unstructured input.
 *
 * Workflow:
 *   1. User opens the panel and types/pastes text or clicks the mic to dictate.
 *   2. "Extract Details" calls /api/extract with the text.
 *   3. Claude returns a { extracted: Record<string, string> } object.
 *   4. Non-null fields are shown as a review list.
 *   5. "Apply to Form" passes the extracted object up via onApply() so the
 *      parent form can merge the values into its own state.
 *
 * Voice recording uses Web Speech API (webkit-prefixed fallback) with en-AU
 * locale. Interim (unconfirmed) words are shown below the textarea in italic
 * while the recognition session is still in progress. Final words append to
 * pastedText so editing across multiple utterances is seamless.
 *
 * The component is purely presentational — it owns no server state. The parent
 * is responsible for persisting sourceText if it should survive tab changes.
 */
'use client'

import { useState, useRef } from 'react'

const FIELD_LABELS: Record<string, string> = {
  client_name: 'Client Name',
  client_phone: 'Phone',
  client_email: 'Email',
  site_address: 'Site Address',
  job_type: 'Job Type',
  urgency: 'Urgency',
  company_name: 'Company',
}

// Web Speech API type shim
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: Event) => void) | null
  onend: (() => void) | null
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface Props {
  onApply: (fields: Record<string, string>) => void
  sourceText?: string
  onSourceText?: (text: string) => void
  defaultOpen?: boolean
}

export default function SmartFill({ onApply, sourceText, onSourceText, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const [pastedText, setPastedText] = useState(sourceText ?? '')
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)
  const [interimText, setInterimText] = useState('')
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)

  function startRecording() {
    const SR = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance; webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).SpeechRecognition
      || (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance; webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).webkitSpeechRecognition
    if (!SR) {
      setError('Voice recording not supported in this browser')
      return
    }
    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-AU'

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      let interim = ''
      let finalChunk = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) {
          finalChunk += t
        } else {
          interim += t
        }
      }
      if (finalChunk) {
        setPastedText(prev => prev ? prev + ' ' + finalChunk.trim() : finalChunk.trim())
        setInterimText('')
      } else {
        setInterimText(interim)
      }
    }

    recognition.onerror = () => {
      setRecording(false)
      setInterimText('')
    }

    recognition.onend = () => {
      setRecording(false)
      setInterimText('')
    }

    recognitionRef.current = recognition
    recognition.start()
    setRecording(true)
    setInterimText('')
  }

  function stopRecording() {
    recognitionRef.current?.stop()
    setRecording(false)
    setInterimText('')
  }

  async function extractDetails() {
    if (!pastedText.trim()) return
    setExtracting(true)
    setExtracted(null)
    setError('')
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pastedText }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setExtracted(data.extracted)
    } catch {
      setError('Could not extract details — try again')
    } finally {
      setExtracting(false)
    }
  }

  function apply() {
    if (!extracted) return
    onApply(extracted)
    if (onSourceText) onSourceText(pastedText)
    setPastedText('')
    setExtracted(null)
    setOpen(false)
  }

  const hasResults = extracted && Object.values(extracted).some(v => v)

  return (
    <>
      <style>{`
        @keyframes sfPulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
          50% { opacity: 0.85; box-shadow: 0 0 0 6px rgba(239,68,68,0); }
        }
        .sf-mic-pulse { animation: sfPulse 1.2s ease-in-out infinite; }
      `}</style>

      <div style={{
        marginBottom: 24,
        border: '1px solid var(--accent)',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 0 0 1px rgba(255,107,53,0.1)',
      }}>
        {/* Header button */}
        <button
          data-devid="P5-E5"
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '15px 16px',
            background: open ? 'rgba(255,107,53,0.12)' : 'var(--accent)',
            border: 'none',
            cursor: 'pointer',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>⚡</span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ color: open ? 'var(--accent)' : '#fff', fontWeight: 800, fontSize: 15 }}>Smart Fill</div>
              <div style={{ color: open ? 'var(--text-muted)' : 'rgba(255,255,255,0.75)', fontSize: 12 }}>Paste a text, email or voicemail — Claude fills the form</div>
            </div>
          </div>
          <span style={{ color: open ? 'var(--text-muted)' : 'rgba(255,255,255,0.8)', fontSize: 12, flexShrink: 0 }}>
            {open ? '▲ Close' : '▼ Open'}
          </span>
        </button>

        {/* Body */}
        {open && (
          <div style={{ padding: 16, background: 'var(--surface-2)', borderTop: '1px solid rgba(255,107,53,0.2)' }}>
            {/* Textarea row */}
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <textarea
                value={pastedText}
                onChange={e => setPastedText(e.target.value)}
                placeholder={`Paste anything here — a text message, email, or voicemail transcript.\n\nExample: "Hi, I'm Dave from Acme. Job at 14 Smith St Paddington, unattended death, been about a week. Call me on 0412 345 678 or dave@acme.com.au"`}
                rows={6}
                style={{ marginBottom: 0, fontSize: 13, lineHeight: 1.5, paddingRight: 52 }}
                autoFocus
              />
              {/* Mic button inside textarea corner */}
              <button
                type="button"
                onClick={recording ? stopRecording : startRecording}
                title={recording ? 'Stop recording' : 'Record voice memo'}
                className={recording ? 'sf-mic-pulse' : ''}
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 17,
                  background: recording ? '#EF4444' : 'rgba(255,255,255,0.1)',
                  color: recording ? '#fff' : 'var(--text-muted)',
                  transition: 'background 0.2s, color 0.2s',
                  flexShrink: 0,
                }}
              >
                🎙
              </button>
            </div>

            {/* Interim transcript */}
            {interimText && (
              <div style={{
                marginBottom: 12,
                padding: '9px 12px',
                borderRadius: 6,
                border: '1px dashed var(--accent)',
                background: 'rgba(255,107,53,0.06)',
                color: 'var(--text-muted)',
                fontSize: 13,
                fontStyle: 'italic',
              }}>
                {interimText}
              </div>
            )}

            {recording && (
              <div style={{
                marginBottom: 12,
                fontSize: 12,
                color: '#EF4444',
                fontWeight: 600,
                letterSpacing: 0.5,
              }}>
                ● Recording… tap 🎙 to stop
              </div>
            )}

            {error && (
              <div style={{ color: '#F87171', fontSize: 13, marginBottom: 10 }}>{error}</div>
            )}

            <button
              type="button"
              onClick={extractDetails}
              disabled={!pastedText.trim() || extracting}
              className="btn btn-primary"
              style={{ fontSize: 13, marginBottom: hasResults ? 16 : 0 }}
            >
              {extracting
                ? <><span className="spinner" /> Claude is reading...</>
                : '⚡ Extract Details'}
            </button>

            {/* Results */}
            {hasResults && (
              <>
                <div style={{
                  fontSize: 11, fontWeight: 700, letterSpacing: 1,
                  textTransform: 'uppercase', color: 'var(--text-muted)',
                  marginBottom: 10,
                }}>
                  Extracted — review before applying
                </div>

                <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
                  {Object.entries(extracted!).filter(([, v]) => v).map(([key, value]) => (
                    <div key={key} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '9px 12px',
                      background: 'var(--surface)',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      fontSize: 13,
                    }}>
                      <span style={{ color: 'var(--text-muted)', minWidth: 110, flexShrink: 0 }}>
                        {FIELD_LABELS[key] || key}
                      </span>
                      <span style={{ color: '#fff', fontWeight: 500 }}>{value}</span>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={apply}
                    className="btn btn-primary"
                    style={{ fontSize: 13 }}
                  >
                    ✓ Apply to Form
                  </button>
                  <button
                    type="button"
                    onClick={() => { setExtracted(null); setPastedText('') }}
                    className="btn btn-ghost"
                    style={{ fontSize: 13 }}
                  >
                    Clear
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}
