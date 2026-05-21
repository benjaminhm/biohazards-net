/*
 * Assessment → Pathogens & pathophysiology.
 *
 * Per-job reference library for microbiology / pathophysiology PDFs. Staff
 * upload disease-reference PDFs (e.g. bloodborne pathogens chapters, public-
 * health fact sheets); the server extracts plain text with Claude on upload
 * and stores it on the job in assessment_data.pathogens_capture. The
 * Assessment Document AI suggester later injects this text as a grounded
 * biology source.
 *
 * This tab is intentionally focused: one uploader, a list of attached
 * references with extraction status, and a free-text notes field. No client-
 * side disease editing — the PDFs are the source of truth and the AI quotes
 * from them; structured disease lists are a future enhancement if needed.
 */
'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { AssessmentData, Job, PathogenReferenceFile, PathogensCapture } from '@/lib/types'

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
}

const MAX_BYTES = 10 * 1024 * 1024 // keep in sync with the upload route

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function statusBadge(status: PathogenReferenceFile['extraction_status']): { label: string; bg: string; color: string } {
  switch (status) {
    case 'ready':
      return { label: 'Extracted', bg: 'rgba(52, 211, 153, 0.18)', color: '#6EE7B7' }
    case 'pending':
      return { label: 'Extracting…', bg: 'rgba(96, 165, 250, 0.18)', color: '#93C5FD' }
    case 'error':
      return { label: 'Extraction failed', bg: 'rgba(248, 113, 113, 0.18)', color: '#FCA5A5' }
  }
}

export default function AssessmentPathogensTab({ job, onJobUpdate }: Props) {
  const capture: PathogensCapture | undefined = job.assessment_data?.pathogens_capture
  const files = capture?.files ?? []

  const [label, setLabel] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [notes, setNotes] = useState(capture?.notes ?? '')
  const [notesSaving, setNotesSaving] = useState(false)
  const [notesError, setNotesError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setNotes(capture?.notes ?? '')
  }, [capture?.notes])

  async function onFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (e.target) e.target.value = ''

    if (file.size > MAX_BYTES) {
      setUploadError(`PDF too large (max ${MAX_BYTES / (1024 * 1024)} MB).`)
      return
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('File must be a PDF.')
      return
    }

    setUploading(true)
    setUploadError('')
    try {
      const form = new FormData()
      form.append('file', file)
      if (label.trim()) form.append('label', label.trim().slice(0, 120))
      const res = await fetch(`/api/jobs/${job.id}/pathogens/upload`, {
        method: 'POST',
        body: form,
      })
      const payload = (await res.json()) as { job?: Job; file?: PathogenReferenceFile; error?: string }
      if (!res.ok || !payload.job) throw new Error(payload.error ?? 'Upload failed')
      onJobUpdate(payload.job)
      setLabel('')
      if (payload.file?.extraction_status === 'error' && payload.file.extraction_error) {
        setUploadError(
          `Uploaded, but text extraction failed: ${payload.file.extraction_error}. The PDF is attached; you can delete and retry.`,
        )
      }
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function deleteFile(fileId: string) {
    if (deletingId) return
    setDeletingId(fileId)
    setUploadError('')
    try {
      const res = await fetch(`/api/jobs/${job.id}/pathogens/${fileId}`, { method: 'DELETE' })
      const payload = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !payload.job) throw new Error(payload.error ?? 'Delete failed')
      onJobUpdate(payload.job)
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  async function saveNotes() {
    setNotesSaving(true)
    setNotesError('')
    try {
      const trimmed = notes.trim().slice(0, 4000)
      const prev: PathogensCapture =
        capture ?? { files: [], updated_at: new Date().toISOString() }
      const nextCapture: PathogensCapture = {
        ...prev,
        notes: trimmed || undefined,
        updated_at: new Date().toISOString(),
      }
      const nextAssessment: AssessmentData = {
        ...((job.assessment_data ?? {}) as AssessmentData),
        pathogens_capture: nextCapture,
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: nextAssessment }),
      })
      const payload = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !payload.job) throw new Error(payload.error ?? 'Could not save notes')
      onJobUpdate(payload.job)
    } catch (err: unknown) {
      setNotesError(err instanceof Error ? err.message : 'Could not save notes')
    } finally {
      setNotesSaving(false)
    }
  }

  const readyCount = files.filter(f => f.extraction_status === 'ready').length
  const errorCount = files.filter(f => f.extraction_status === 'error').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingTop: 8 }}>
      <div>
        <h2 style={{ margin: 0, marginBottom: 6, fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
          Pathogens &amp; pathophysiology
        </h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)', maxWidth: 720 }}>
          Attach reference PDFs (microbiology, pathophysiology, public-health fact sheets) for the
          diseases relevant to this job. The text content is extracted on upload and supplied to the
          Assessment Document AI as a grounded source of truth for transmission routes, human-health
          effects, incubation periods, and PPE — preventing the model from inventing biology.
        </p>
      </div>

      {/* Uploader */}
      <div
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Add reference PDF
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="Optional label e.g. 'Bloodborne pathogens — CDC overview'"
            style={{
              flex: '1 1 280px',
              minWidth: 240,
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface-0)',
              color: 'var(--text)',
              fontSize: 13,
            }}
            disabled={uploading}
            maxLength={120}
          />
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={onFileSelect}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: '1px solid var(--accent)',
              background: uploading ? 'rgba(249, 115, 22, 0.4)' : 'var(--accent)',
              color: 'white',
              fontSize: 13,
              fontWeight: 600,
              cursor: uploading ? 'wait' : 'pointer',
            }}
          >
            {uploading ? 'Uploading & extracting…' : 'Upload PDF'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          PDF only · max {MAX_BYTES / (1024 * 1024)} MB · text extraction runs automatically and may take a few seconds.
        </div>
        {uploadError && (
          <div style={{ fontSize: 12, color: '#FCA5A5', background: 'rgba(248, 113, 113, 0.1)', border: '1px solid rgba(248, 113, 113, 0.3)', padding: '8px 10px', borderRadius: 6 }}>
            {uploadError}
          </div>
        )}
      </div>

      {/* File list */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Attached references {files.length > 0 ? `(${files.length})` : ''}
          </div>
          {files.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {readyCount} extracted{errorCount > 0 ? ` · ${errorCount} failed` : ''}
            </div>
          )}
        </div>
        {files.length === 0 ? (
          <div
            style={{
              padding: '24px 16px',
              border: '1px dashed var(--border)',
              borderRadius: 10,
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
            }}
          >
            No reference PDFs attached yet. The Assessment Document AI will still draft, but
            biology claims will rely on its general training data rather than your sources.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {files.map(f => {
              const badge = statusBadge(f.extraction_status)
              const extractedChars = f.extracted_text?.length ?? 0
              return (
                <div
                  key={f.id}
                  style={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                    <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.label || f.file_name}
                      </div>
                      {f.label && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {f.file_name}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {formatBytes(f.file_size)} · uploaded {new Date(f.uploaded_at).toLocaleString()}
                        {f.extraction_status === 'ready' && extractedChars > 0 && ` · ${extractedChars.toLocaleString()} chars extracted`}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '3px 8px',
                        borderRadius: 999,
                        background: badge.bg,
                        color: badge.color,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {badge.label}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <a
                        href={f.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          padding: '6px 12px',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'var(--surface-0)',
                          color: 'var(--text)',
                          fontSize: 12,
                          fontWeight: 600,
                          textDecoration: 'none',
                        }}
                      >
                        View PDF
                      </a>
                      <button
                        type="button"
                        onClick={() => deleteFile(f.id)}
                        disabled={deletingId === f.id}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 6,
                          border: '1px solid rgba(248, 113, 113, 0.45)',
                          background: 'transparent',
                          color: '#FCA5A5',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: deletingId === f.id ? 'wait' : 'pointer',
                        }}
                      >
                        {deletingId === f.id ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                  </div>
                  {f.extraction_status === 'error' && f.extraction_error && (
                    <div style={{ fontSize: 12, color: '#FCA5A5' }}>
                      Extraction error: {f.extraction_error}
                    </div>
                  )}
                  {f.extraction_status === 'ready' && f.extracted_text && (
                    <details>
                      <summary style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
                        Show extracted text preview
                      </summary>
                      <div
                        style={{
                          marginTop: 8,
                          padding: 10,
                          background: 'var(--surface-0)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          maxHeight: 220,
                          overflow: 'auto',
                          whiteSpace: 'pre-wrap',
                          fontSize: 12,
                          lineHeight: 1.5,
                          color: 'var(--text-muted)',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        }}
                      >
                        {f.extracted_text.slice(0, 4000)}
                        {f.extracted_text.length > 4000 ? '\n\n…(truncated for preview; full text used by AI)' : ''}
                      </div>
                    </details>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Notes */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
          Notes for the AI (optional)
        </div>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="e.g. 'Prioritise the CDC bloodborne reference over the WHO sheet for transmission claims.'"
          maxLength={4000}
          rows={3}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface-1)',
            color: 'var(--text)',
            fontSize: 13,
            lineHeight: 1.5,
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <div style={{ fontSize: 11, color: notesError ? '#FCA5A5' : 'var(--text-muted)' }}>
            {notesError || `${notes.trim().length} / 4000 characters`}
          </div>
          <button
            type="button"
            onClick={saveNotes}
            disabled={notesSaving || (notes.trim() === (capture?.notes ?? ''))}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: notesSaving ? 'rgba(249, 115, 22, 0.4)' : 'var(--accent)',
              color: 'white',
              fontSize: 12,
              fontWeight: 600,
              cursor: notesSaving ? 'wait' : 'pointer',
              opacity: notes.trim() === (capture?.notes ?? '') ? 0.5 : 1,
            }}
          >
            {notesSaving ? 'Saving…' : 'Save notes'}
          </button>
        </div>
      </div>
    </div>
  )
}
