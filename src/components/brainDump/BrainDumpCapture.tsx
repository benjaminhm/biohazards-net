/*
 * components/brainDump/BrainDumpCapture.tsx
 *
 * Capture panel for the Brain Dump room. Textarea + voice dictation (Web
 * Speech API) + AI polish (grammar/spelling only, org-scoped). Primary
 * action calls onStructure(text) which the parent wires to
 * POST /api/brain-dump/structure.
 *
 * Deliberately self-contained (no jobId coupling like CaptureFieldToolbar)
 * so it can be dropped into any org-level room. If we add more rooms later
 * that want the same pattern, this is the reusable piece.
 */
'use client'

import { useEffect, useRef, useState } from 'react'

const MAX_FIELD = 20_000

type SpeechRecognitionInstance = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: (e: {
    resultIndex: number
    results: { isFinal: boolean; 0: { transcript: string } }[]
  }) => void
  onerror: (e: { error: string }) => void
  onend: () => void
  start: () => void
  stop: () => void
}

interface Props {
  onStructure: (text: string) => Promise<void> | void
  structuring: boolean
}

export default function BrainDumpCapture({ onStructure, structuring }: Props) {
  const [text, setText] = useState('')
  const [dictating, setDictating] = useState(false)
  const [interim, setInterim] = useState('')
  const [polishing, setPolishing] = useState(false)
  const [error, setError] = useState('')
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const speechGenRef = useRef(0)
  const textRef = useRef(text)
  textRef.current = text

  useEffect(() => {
    return () => {
      speechGenRef.current += 1
      recognitionRef.current?.stop()
      recognitionRef.current = null
    }
  }, [])

  function stopDictation() {
    speechGenRef.current += 1
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setDictating(false)
    setInterim('')
  }

  function startDictation() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setError('Voice input is not supported in this browser. Try Chrome.')
      return
    }
    stopDictation()
    const gen = speechGenRef.current
    const recognition: SpeechRecognitionInstance = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = navigator.language || 'en-AU'

    recognition.onresult = e => {
      let finalChunk = ''
      let liveInterim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript
        if (e.results[i].isFinal) finalChunk += transcript + ' '
        else liveInterim += transcript
      }
      if (finalChunk) {
        const next = (textRef.current + finalChunk).slice(0, MAX_FIELD)
        setText(next)
      }
      setInterim(liveInterim)
    }
    recognition.onerror = ev => {
      if (ev.error !== 'no-speech') setError(`Mic: ${ev.error}`)
      stopDictation()
    }
    recognition.onend = () => {
      if (gen !== speechGenRef.current) return
      recognitionRef.current = null
      setDictating(false)
      setInterim('')
    }
    recognitionRef.current = recognition
    recognition.start()
    setDictating(true)
    setError('')
  }

  async function handlePolish() {
    const t = text.trim()
    if (!t) return
    setError('')
    setPolishing(true)
    try {
      const res = await fetch('/api/polish-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t }),
      })
      const data = (await res.json()) as { text?: string; error?: string }
      if (!res.ok) throw new Error(data.error || 'Polish failed')
      if (typeof data.text === 'string') setText(data.text.slice(0, MAX_FIELD))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Polish failed')
    } finally {
      setPolishing(false)
    }
  }

  async function handleStructure() {
    const t = text.trim()
    if (!t) return
    setError('')
    try {
      await onStructure(t)
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI structure failed')
    }
  }

  const busy = polishing || structuring || dictating
  const canSubmit = !!text.trim() && !structuring && !polishing

  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 4,
          }}
        >
          Brain dump
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Dictate or paste freeform thoughts. AI will split them into todos,
          reminders, notes, and moments. Review and edit anything below.
        </div>
      </div>

      <textarea
        value={text}
        onChange={e => setText(e.target.value.slice(0, MAX_FIELD))}
        placeholder="e.g. Call Steve tomorrow about the Annerley job. Order two more boxes of tyvek. Saw an interesting mould growth pattern in the kitchen — photo on phone. Insurance from IAG on the hoarding job is Claim 8847231."
        rows={8}
        style={{
          width: '100%',
          minHeight: 160,
          padding: '12px 14px',
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: 'var(--surface-2)',
          color: 'var(--text)',
          fontSize: 14,
          lineHeight: 1.55,
          resize: 'vertical',
          boxSizing: 'border-box',
          fontFamily: 'inherit',
        }}
      />

      {dictating && interim && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: -4 }}>
          {interim}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => (dictating ? stopDictation() : startDictation())}
          disabled={polishing || structuring}
          title={dictating ? 'Stop dictation' : 'Dictate (voice)'}
        >
          {dictating ? '● Stop mic' : '🎤 Dictate'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void handlePolish()}
          disabled={!text.trim() || busy}
          title="Fix spelling and grammar only"
        >
          {polishing ? 'Polishing…' : 'AI polish'}
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => void handleStructure()}
          disabled={!canSubmit}
          style={{
            padding: '10px 16px',
            borderRadius: 10,
            border: 'none',
            background: canSubmit ? 'var(--accent)' : 'var(--surface-3)',
            color: canSubmit ? '#fff' : 'var(--text-dim)',
            fontWeight: 700,
            fontSize: 13,
            cursor: canSubmit ? 'pointer' : 'default',
            transition: 'background 0.15s',
          }}
        >
          {structuring ? 'Structuring…' : 'Structure with AI →'}
        </button>
      </div>

      {error && (
        <div style={{ color: '#F87171', fontSize: 12 }} role="alert">
          {error}
        </div>
      )}
    </section>
  )
}
