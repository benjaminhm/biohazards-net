'use client'

import { useMemo, useState } from 'react'
import { highlightParts, searchDocument, type DocumentMatch } from '@/lib/documentAsk'

interface Turn {
  id: string
  question: string
  answer: string
  quotes: string[]
  matches: DocumentMatch[]
}

interface Props {
  jobId: string
  label: string
  /** Plain text of the document the staff member is looking at, including an unsaved scope draft. */
  text: string
  defaultOpen?: boolean
}

function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) => part.hit ? (
        <mark key={index} style={{ background: 'var(--accent-dim)', color: 'inherit', padding: '0 2px', borderRadius: 3 }}>{part.text}</mark>
      ) : (
        <span key={index}>{part.text}</span>
      ))}
    </>
  )
}

function MatchList({ matches, query }: { matches: DocumentMatch[]; query: string }) {
  if (!matches.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {matches.map(match => (
        <div key={`${match.heading}:${match.text}`} style={{ fontSize: 13, lineHeight: 1.45 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 2 }}>
            {match.heading}
          </div>
          <div><Marked text={match.text} query={query} /></div>
        </div>
      ))}
    </div>
  )
}

export default function DocumentAskPanel({ jobId, label, text, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const [searchQuery, setSearchQuery] = useState('')
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])

  const searchMatches = useMemo(
    () => (searchQuery.trim() ? searchDocument(text, searchQuery) : []),
    [text, searchQuery],
  )

  async function ask() {
    const nextQuestion = question.trim()
    if (!nextQuestion || asking) return
    setAsking(true)
    setError('')
    try {
      const res = await fetch(`/api/jobs/${jobId}/ask-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: nextQuestion,
          label,
          text,
          history: turns.slice(-6).map(turn => ({ question: turn.question, answer: turn.answer })),
        }),
      })
      const data = await res.json() as { answer?: string; quotes?: string[]; error?: string }
      if (!res.ok || !data.answer) throw new Error(data.error || 'No answer came back.')
      setTurns(prev => [...prev, {
        id: `${Date.now()}-${prev.length}`,
        question: nextQuestion,
        answer: data.answer ?? '',
        quotes: Array.isArray(data.quotes) ? data.quotes.filter(quote => typeof quote === 'string') : [],
        matches: searchDocument(text, nextQuestion),
      }])
      setQuestion('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No answer came back.')
    } finally {
      setAsking(false)
    }
  }

  return (
    <section
      style={{
        marginBottom: 16,
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--surface-2)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'none',
          border: 'none',
          color: 'var(--text)',
          cursor: 'pointer',
          padding: '10px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Ask about this document
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
            Search the wording, or ask what {label} says. The answer stays on this screen and is not sent to the client.
          </p>

          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6, color: 'var(--text-muted)' }}>
              Search the wording
            </span>
            <input
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="cement sheet fibre"
              style={{
                width: '100%',
                fontSize: 14,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
              }}
            />
          </label>
          {searchQuery.trim() && (
            searchMatches.length
              ? <MatchList matches={searchMatches} query={searchQuery} />
              : <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nothing in this document matches that.</div>
          )}

          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6, color: 'var(--text-muted)' }}>
              Ask a question
            </span>
            <textarea
              value={question}
              onChange={event => setQuestion(event.target.value)}
              rows={2}
              placeholder="What does this document say about cement sheet fibre?"
              onKeyDown={event => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void ask()
                }
              }}
              style={{
                width: '100%',
                fontSize: 14,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                resize: 'vertical',
                lineHeight: 1.45,
                fontFamily: 'inherit',
              }}
            />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => { void ask() }}
              disabled={asking || !question.trim() || !text.trim()}
              style={{ fontSize: 13, padding: '8px 12px' }}
            >
              {asking ? 'Asking…' : 'Ask'}
            </button>
          </div>
          {error && <div role="alert" style={{ fontSize: 13, color: 'var(--danger, #f87171)' }}>{error}</div>}

          {turns.length > 0 && (
            <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[...turns].reverse().map(turn => (
                <article key={turn.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{turn.question}</div>
                  <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{turn.answer}</div>
                  {turn.quotes.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {turn.quotes.map(quote => (
                        <blockquote key={quote} style={{ margin: 0, paddingLeft: 10, borderLeft: '2px solid var(--border)', fontSize: 13, color: 'var(--text-muted)' }}>
                          {quote}
                        </blockquote>
                      ))}
                    </div>
                  )}
                  {turn.matches.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <MatchList matches={turn.matches} query={turn.question} />
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
