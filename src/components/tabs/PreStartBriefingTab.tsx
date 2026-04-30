'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { Job } from '@/lib/types'

const MAX_TITLE = 240
const MAX_DESCRIPTION = 50_000

interface Props {
  job: Job
}

interface PreStartBriefing {
  id: string
  job_id: string
  title: string
  description: string
  video_url: string
  thumbnail_url: string | null
  created_at: string
  updated_at: string
}

interface AckPerson {
  id: string
  name: string
  role: string
}

interface PreStartAcknowledgement {
  id: string
  briefing_id: string
  person_id: string
  viewed_at: string | null
  acknowledged_at: string | null
  updated_at: string
  people?: AckPerson | AckPerson[] | null
}

function firstPerson(value: AckPerson | AckPerson[] | null | undefined): AckPerson | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return 'Not acknowledged'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const cardStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 14,
  background: 'var(--surface)',
  padding: 16,
}

const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '10px 12px',
  fontSize: 14,
}

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 6,
}

export default function PreStartBriefingTab({ job }: Props) {
  const [briefings, setBriefings] = useState<PreStartBriefing[]>([])
  const [acknowledgements, setAcknowledgements] = useState<PreStartAcknowledgement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [thumbnailUrl, setThumbnailUrl] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const ackByBriefing = useMemo(() => {
    const map = new Map<string, PreStartAcknowledgement[]>()
    acknowledgements.forEach(ack => {
      const current = map.get(ack.briefing_id) ?? []
      current.push(ack)
      map.set(ack.briefing_id, current)
    })
    return map
  }, [acknowledgements])

  const refresh = useCallback(async () => {
    setError('')
    const res = await fetch(`/api/jobs/${job.id}/prestart-briefings`)
    const data = (await res.json()) as {
      briefings?: PreStartBriefing[]
      acknowledgements?: PreStartAcknowledgement[]
      error?: string
    }
    if (!res.ok) throw new Error(data.error ?? 'Could not load pre-start briefings')
    setBriefings(data.briefings ?? [])
    setAcknowledgements(data.acknowledgements ?? [])
  }, [job.id])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    refresh()
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load pre-start briefings')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [job.id, refresh])

  function resetForm() {
    setTitle('')
    setDescription('')
    setVideoUrl('')
    setThumbnailUrl('')
    setEditingId(null)
  }

  function startEdit(briefing: PreStartBriefing) {
    setEditingId(briefing.id)
    setTitle(briefing.title)
    setDescription(briefing.description ?? '')
    setVideoUrl(briefing.video_url)
    setThumbnailUrl(briefing.thumbnail_url ?? '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveBriefing() {
    const trimmedTitle = title.trim()
    const trimmedDescription = description.trim()
    const trimmedVideoUrl = videoUrl.trim()
    const trimmedThumbnailUrl = thumbnailUrl.trim()
    if (!trimmedTitle || !trimmedVideoUrl) {
      window.alert('Add a title and video URL before saving.')
      return
    }
    if (trimmedTitle.length > MAX_TITLE || trimmedDescription.length > MAX_DESCRIPTION) {
      window.alert('The title or notes are too long.')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}/prestart-briefings`, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          briefing_id: editingId ?? undefined,
          title: trimmedTitle,
          description: trimmedDescription,
          video_url: trimmedVideoUrl,
          thumbnail_url: trimmedThumbnailUrl || null,
        }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not save pre-start briefing')
      resetForm()
      await refresh()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not save pre-start briefing')
    } finally {
      setSaving(false)
    }
  }

  async function deleteBriefing(briefingId: string) {
    if (!window.confirm('Delete this pre-start briefing? This also removes its acknowledgement history.')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}/prestart-briefings`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefing_id: briefingId }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not delete pre-start briefing')
      if (editingId === briefingId) resetForm()
      await refresh()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not delete pre-start briefing')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section style={cardStyle}>
        <div style={{ fontSize: 18, fontWeight: 850, marginBottom: 6 }}>
          {editingId ? 'Edit Pre-start Briefing' : 'Add Pre-start Briefing'}
        </div>
        <p style={{ margin: '0 0 14px', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.55 }}>
          Add a briefing video link and job-specific notes. Assigned team members will see it in the field job view and can acknowledge that they watched and understood it.
        </p>
        <div style={{ display: 'grid', gap: 12 }}>
          <label>
            <div style={labelStyle}>Title</div>
            <input
              value={title}
              onChange={e => setTitle(e.target.value.slice(0, MAX_TITLE))}
              placeholder="e.g. Pre-start briefing for trauma cleanup"
              style={inputStyle}
            />
          </label>
          <label>
            <div style={labelStyle}>Video URL</div>
            <input
              value={videoUrl}
              onChange={e => setVideoUrl(e.target.value)}
              placeholder="https://..."
              style={inputStyle}
            />
          </label>
          <label>
            <div style={labelStyle}>Thumbnail URL (optional)</div>
            <input
              value={thumbnailUrl}
              onChange={e => setThumbnailUrl(e.target.value)}
              placeholder="https://..."
              style={inputStyle}
            />
          </label>
          <label>
            <div style={labelStyle}>Briefing Notes</div>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
              placeholder="Cover PPE, access, hazards, disposal, exclusion zones, and any site-specific instructions."
              rows={7}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
            />
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={saveBriefing} disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Add Briefing'}
            </button>
            {editingId && (
              <button className="btn btn-secondary" onClick={resetForm} disabled={saving}>
                Cancel Edit
              </button>
            )}
          </div>
        </div>
      </section>

      {loading && <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading pre-start briefings...</div>}
      {error && <div style={{ color: '#FCA5A5', fontSize: 14 }}>{error}</div>}

      {!loading && briefings.length === 0 && (
        <section style={cardStyle}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>No pre-start briefings yet</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.55 }}>
            Add the first video above so the field team can review it before starting work.
          </div>
        </section>
      )}

      {briefings.map(briefing => {
        const acks = ackByBriefing.get(briefing.id) ?? []
        return (
          <section key={briefing.id} style={cardStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'start' }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 850, marginBottom: 5 }}>{briefing.title}</div>
                <a href={briefing.video_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 750 }}>
                  Open video
                </a>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => startEdit(briefing)} disabled={saving}>
                  Edit
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => deleteBriefing(briefing.id)} disabled={saving}>
                  Delete
                </button>
              </div>
            </div>

            {briefing.thumbnail_url && (
              <a href={briefing.video_url} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 12 }}>
                <div
                  aria-label=""
                  style={{
                    width: '100%',
                    height: 260,
                    background: `url(${briefing.thumbnail_url}) center / cover`,
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                  }}
                />
              </a>
            )}

            {briefing.description && (
              <div style={{ marginTop: 12, color: 'var(--text)', fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                {briefing.description}
              </div>
            )}

            <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ ...labelStyle, marginBottom: 8 }}>Acknowledgements ({acks.filter(ack => ack.acknowledged_at).length})</div>
              {acks.length > 0 ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {acks.map(ack => {
                    const person = firstPerson(ack.people)
                    return (
                      <div key={ack.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: 'var(--text-muted)' }}>
                        <span style={{ color: 'var(--text)', fontWeight: 750 }}>{person?.name ?? 'Team member'}</span>
                        <span>{formatWhen(ack.acknowledged_at)}</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No acknowledgements yet.</div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
