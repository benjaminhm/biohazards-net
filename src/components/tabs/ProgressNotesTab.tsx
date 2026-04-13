/*
 * components/tabs/ProgressNotesTab.tsx
 *
 * Home → Progress notes — job-scoped notes with room, voice-to-text, list,
 * edit, archive, and soft delete (API + progress_notes table).
 */
'use client'

import { useState, useEffect, useRef, useMemo, type CSSProperties } from 'react'
import type { Job, ProgressNote } from '@/lib/types'
import { AREA_ROOM_TYPES, areaRoomSelectValue } from '@/lib/areaRoomTypes'

const MAX_BODY = 50_000

type SpeechRecognitionInstance = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: (e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void
  onerror: (e: { error: string }) => void
  onend: () => void
  start: () => void
  stop: () => void
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function mergeRoomOptions(job: Job): string[] {
  const fromAssessment = (job.assessment_data?.areas ?? [])
    .map(a => (a.name || '').trim())
    .filter(Boolean)
  const set = new Set<string>([...AREA_ROOM_TYPES, ...fromAssessment])
  return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

interface Props {
  job: Job
}

export default function ProgressNotesTab({ job }: Props) {
  const [notes, setNotes] = useState<ProgressNote[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)

  const [composerRoomSelect, setComposerRoomSelect] = useState('')
  const [composerRoomOther, setComposerRoomOther] = useState('')
  const [composerBody, setComposerBody] = useState('')
  const [speechError, setSpeechError] = useState('')
  const [speechActive, setSpeechActive] = useState(false)
  const [interimText, setInterimText] = useState('')
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const speechGenRef = useRef(0)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [editRoomSelect, setEditRoomSelect] = useState('')
  const [editRoomOther, setEditRoomOther] = useState('')

  const [showArchived, setShowArchived] = useState(false)

  const roomOptions = useMemo(() => mergeRoomOptions(job), [job])

  const activeNotes = useMemo(() => notes.filter(n => !n.archived_at), [notes])
  const archivedNotes = useMemo(() => notes.filter(n => n.archived_at), [notes])

  async function refresh() {
    setLoadError('')
    const res = await fetch(`/api/jobs/${job.id}/progress-notes`)
    const data = (await res.json()) as { notes?: ProgressNote[]; error?: string }
    if (!res.ok) throw new Error(data.error ?? 'Failed to load notes')
    setNotes(data.notes ?? [])
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    refresh()
      .catch(e => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [job.id])

  function resolvedComposerRoom(): string {
    if (composerRoomSelect === '__other__') return composerRoomOther.trim()
    return composerRoomSelect.trim()
  }

  function stopSpeech() {
    speechGenRef.current += 1
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setSpeechActive(false)
    setInterimText('')
  }

  function startSpeech() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setSpeechError('Voice input is not supported in this browser. Try Chrome.')
      return
    }
    stopSpeech()
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
        setComposerBody(prev => (prev + finalChunk).slice(0, MAX_BODY))
      }
      setInterimText(interim)
    }
    recognition.onerror = ev => {
      if (ev.error !== 'no-speech') setSpeechError(`Mic: ${ev.error}`)
      stopSpeech()
    }
    recognition.onend = () => {
      if (gen !== speechGenRef.current) return
      recognitionRef.current = null
      setSpeechActive(false)
      setInterimText('')
    }
    recognitionRef.current = recognition
    recognition.start()
    setSpeechActive(true)
    setSpeechError('')
  }

  async function handleSaveNew() {
    const body = composerBody.trim()
    if (!body.length) return
    if (body.length > MAX_BODY) {
      window.alert(`Note must be at most ${MAX_BODY} characters.`)
      return
    }
    const room = resolvedComposerRoom()
    setSaving(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}/progress-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, body }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      setComposerBody('')
      setComposerRoomOther('')
      setComposerRoomSelect('')
      await refresh()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function beginEdit(n: ProgressNote) {
    setEditingId(n.id)
    const raw = (n.room || '').trim()
    const sel = areaRoomSelectValue(raw)
    if (sel === '__other__') {
      setEditRoomSelect('__other__')
      setEditRoomOther(raw)
    } else {
      setEditRoomSelect(sel)
      setEditRoomOther('')
    }
    setEditBody(n.body)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditBody('')
    setEditRoomSelect('')
    setEditRoomOther('')
  }

  function resolvedEditRoom(): string {
    if (editRoomSelect === '__other__') return editRoomOther.trim()
    return editRoomSelect.trim()
  }

  async function saveEdit() {
    if (!editingId) return
    const body = editBody.trim()
    if (!body.length) {
      window.alert('Note cannot be empty.')
      return
    }
    if (body.length > MAX_BODY) {
      window.alert(`Note must be at most ${MAX_BODY} characters.`)
      return
    }
    const room = resolvedEditRoom()
    setSaving(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}/progress-notes/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, room }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Update failed')
      cancelEdit()
      await refresh()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  async function setArchived(noteId: string, archived: boolean) {
    try {
      const res = await fetch(`/api/jobs/${job.id}/progress-notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Request failed')
      await refresh()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Request failed')
    }
  }

  async function removeNote(noteId: string) {
    if (!window.confirm('Delete this note? It will be hidden but kept for audit.')) return
    try {
      const res = await fetch(`/api/jobs/${job.id}/progress-notes/${noteId}`, { method: 'DELETE' })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Delete failed')
      if (editingId === noteId) cancelEdit()
      await refresh()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const micStyle = (active: boolean): CSSProperties => ({
    width: 40,
    height: 40,
    borderRadius: '50%',
    flexShrink: 0,
    border: `2px solid ${active ? '#EF4444' : 'var(--border-2)'}`,
    background: active ? 'rgba(239,68,68,0.1)' : 'var(--surface-3)',
    color: active ? '#EF4444' : 'var(--text-muted)',
    fontSize: 18,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  })

  function NoteCard({ n }: { n: ProgressNote }) {
    const isEditing = editingId === n.id
    const editOptions = (() => {
      const s = new Set(roomOptions)
      const r = (n.room || '').trim()
      if (r) s.add(r)
      return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    })()
    return (
      <div
        className="card"
        style={{
          marginBottom: 12,
          opacity: n.archived_at ? 0.85 : 1,
          border: n.archived_at ? '1px dashed var(--border)' : undefined,
        }}
      >
        {isEditing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12 }}>Room</label>
              <select
                value={editRoomSelect}
                onChange={e => setEditRoomSelect(e.target.value)}
                style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8 }}
              >
                <option value="">—</option>
                {editOptions.map(r => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
                <option value="__other__">Other (specify)</option>
              </select>
              {editRoomSelect === '__other__' && (
                <input
                  value={editRoomOther}
                  onChange={e => setEditRoomOther(e.target.value)}
                  placeholder="Room or area"
                  style={{ width: '100%', marginTop: 8 }}
                />
              )}
            </div>
            <div>
              <label style={{ fontSize: 12 }}>Note</label>
              <textarea
                value={editBody}
                onChange={e => setEditBody(e.target.value.slice(0, MAX_BODY))}
                rows={5}
                style={{ width: '100%', marginTop: 4, resize: 'vertical' }}
                maxLength={MAX_BODY}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={saveEdit}>
                Save
              </button>
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={cancelEdit}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{n.room ? n.room : '—'}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
                <div>Created {formatWhen(n.created_at)} · {n.created_by_first_name}</div>
                {n.updated_at !== n.created_at && (
                  <div>
                    Edited {formatWhen(n.updated_at)} · {n.updated_by_first_name}
                  </div>
                )}
                {n.archived_at && (
                  <div style={{ marginTop: 4 }}>
                    Archived {formatWhen(n.archived_at)}
                    {n.archived_by_first_name ? ` · ${n.archived_by_first_name}` : ''}
                  </div>
                )}
              </div>
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{n.body}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => beginEdit(n)}>
                Edit
              </button>
              {!n.archived_at ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 13 }}
                  onClick={() => setArchived(n.id, true)}
                >
                  Archive
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 13 }}
                  onClick={() => setArchived(n.id, false)}
                >
                  Unarchive
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 13, color: '#F87171' }}
                onClick={() => removeNote(n.id)}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
        Progress notes are saved to this job with room, author, and timestamps. Deleted notes are hidden but retained
        for audit.
      </p>

      {loadError && <div style={{ color: '#F87171', marginBottom: 12 }}>{loadError}</div>}
      {speechError && <div style={{ color: '#F87171', marginBottom: 12, fontSize: 13 }}>{speechError}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 12 }}>
          New note
        </div>
        <label>Room</label>
        <select
          value={composerRoomSelect}
          onChange={e => setComposerRoomSelect(e.target.value)}
          style={{ width: '100%', marginTop: 4, marginBottom: 12, padding: '10px 12px', borderRadius: 8 }}
        >
          <option value="">Optional — select room</option>
          {roomOptions.map(r => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
          <option value="__other__">Other (specify)</option>
        </select>
        {composerRoomSelect === '__other__' && (
          <input
            value={composerRoomOther}
            onChange={e => setComposerRoomOther(e.target.value)}
            placeholder="Room or area name"
            style={{ width: '100%', marginBottom: 12 }}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
          <label style={{ margin: 0 }}>Note</label>
          <button
            type="button"
            title={speechActive ? 'Stop dictation' : 'Speak to add text'}
            onClick={() => (speechActive ? stopSpeech() : startSpeech())}
            style={micStyle(speechActive)}
          >
            🎙
          </button>
        </div>
        {speechActive && interimText && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              fontStyle: 'italic',
              marginBottom: 8,
            }}
          >
            {interimText}
          </div>
        )}
        <textarea
          value={composerBody}
          onChange={e => setComposerBody(e.target.value.slice(0, MAX_BODY))}
          placeholder="Type or use the microphone…"
          rows={4}
          maxLength={MAX_BODY}
          style={{ width: '100%', resize: 'vertical' }}
        />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          {composerBody.length.toLocaleString()} / {MAX_BODY.toLocaleString()} characters
        </div>
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          disabled={saving || !composerBody.trim().length}
          onClick={handleSaveNew}
        >
          {saving ? 'Saving…' : 'Save note'}
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading notes…</div>
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 12 }}>
            Active ({activeNotes.length})
          </div>
          {activeNotes.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No active notes yet.</p>
          ) : (
            activeNotes.map(n => <NoteCard key={n.id} n={n} />)
          )}

          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: 16, marginBottom: 8, fontSize: 13 }}
            onClick={() => setShowArchived(s => !s)}
          >
            {showArchived ? 'Hide archived' : `Show archived (${archivedNotes.length})`}
          </button>

          {showArchived && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 12, marginTop: 8 }}>
                Archived ({archivedNotes.length})
              </div>
              {archivedNotes.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No archived notes.</p>
              ) : (
                archivedNotes.map(n => <NoteCard key={n.id} n={n} />)
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
