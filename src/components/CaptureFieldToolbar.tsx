/*
 * Listen (read-aloud), Dictate (speech-to-text), AI polish — same pattern as Scope / Assessment document tabs.
 */
'use client'

import { useEffect, useRef, useState } from 'react'

const MAX_FIELD = 48_000

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
  jobId: string
  text: string
  onTextChange: (next: string) => void
  /** Disable polish while another operation runs globally (optional). */
  polishBusy?: boolean
}

export default function CaptureFieldToolbar({ jobId, text, onTextChange, polishBusy }: Props) {
  const [speaking, setSpeaking] = useState(false)
  const [polishing, setPolishing] = useState(false)
  const [polishError, setPolishError] = useState('')
  const [dictating, setDictating] = useState(false)
  const [interim, setInterim] = useState('')
  const [speechError, setSpeechError] = useState('')
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const speechGenRef = useRef(0)
  const textRef = useRef(text)
  textRef.current = text

  useEffect(() => {
    return () => {
      speechGenRef.current += 1
      recognitionRef.current?.stop()
      recognitionRef.current = null
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  function handleListen() {
    if (typeof window === 'undefined') return
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    const t = text.trim()
    if (!t) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(t)
    u.lang = 'en-AU'
    u.onstart = () => setSpeaking(true)
    u.onend = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(u)
  }

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
      setSpeechError('Voice input is not supported in this browser. Try Chrome.')
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
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript
        if (e.results[i].isFinal) finalChunk += transcript + ' '
        else interim += transcript
      }
      if (finalChunk) {
        onTextChange((textRef.current + finalChunk).slice(0, MAX_FIELD))
      }
      setInterim(interim)
    }
    recognition.onerror = ev => {
      if (ev.error !== 'no-speech') setSpeechError(`Mic: ${ev.error}`)
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
    setSpeechError('')
  }

  async function handlePolish() {
    const t = text.trim()
    if (!t) return
    setPolishError('')
    setPolishing(true)
    try {
      const res = await fetch(`/api/jobs/${jobId}/polish-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t }),
      })
      const data = (await res.json()) as { text?: string; error?: string }
      if (!res.ok) throw new Error(data.error || 'Polish failed')
      const next = typeof data.text === 'string' ? data.text : t
      onTextChange(next.slice(0, MAX_FIELD))
    } catch (e) {
      setPolishError(e instanceof Error ? e.message : 'Polish failed')
    } finally {
      setPolishing(false)
    }
  }

  const busy = polishBusy || polishing

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!text.trim() && !speaking}
          onClick={handleListen}
          title={speaking ? 'Stop playback' : 'Read aloud (device text-to-speech)'}
        >
          {speaking ? 'Stop' : 'Listen'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => (dictating ? stopDictation() : startDictation())}
          title={dictating ? 'Stop dictation' : 'Speak to add text'}
        >
          {dictating ? 'Stop mic' : 'Dictate'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!text.trim() || busy}
          onClick={() => void handlePolish()}
          title="Fix spelling and grammar only (AI)"
        >
          {polishing ? 'Polishing…' : 'AI polish'}
        </button>
      </div>
      {(speechError || polishError) && (
        <div style={{ color: '#F87171', fontSize: 12, marginTop: 6 }} role="alert">
          {speechError || polishError}
        </div>
      )}
      {dictating && interim && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>{interim}</div>
      )}
    </div>
  )
}
