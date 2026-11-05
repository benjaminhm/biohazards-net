/*
 * Home → Company Letterhead.
 *
 * Staff write the letter in the editor (or draft it from a brief via
 * suggest-letterhead-body, then edit) and attach images. Generate document
 * saves the letter, then opens the print preview with the company letterhead.
 */
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Job } from '@/lib/types'
import RichTextEditor from '@/components/RichTextEditor'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { useRegisterUnsavedChanges } from '@/lib/unsavedChangesContext'
import { proseHasPrintableContent } from '@/lib/richTextPrint'
import {
  companyLetterheadHasContent,
  normalizeCompanyLetterheadCapture,
  type CompanyLetterheadCapture,
  type CompanyLetterheadImage,
} from '@/lib/companyLetterhead'

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
}

const MAX_IMAGES = 12

async function compressImage(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img')
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width)
          width = maxDim
        } else {
          width = Math.round((width * maxDim) / height)
          height = maxDim
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not prepare that image'))
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Could not prepare that image'))),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not read that image'))
    }
    img.src = objectUrl
  })
}

function capturesEqual(a: CompanyLetterheadCapture, b: CompanyLetterheadCapture): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export default function CompanyLetterheadTab({ job, onJobUpdate }: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const saved = useMemo(
    () => normalizeCompanyLetterheadCapture(job.assessment_data?.company_letterhead),
    [job.assessment_data?.company_letterhead],
  )
  const [capture, setCapture] = useState<CompanyLetterheadCapture>(saved)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [prompt, setPrompt] = useState('')
  const [drafting, setDrafting] = useState(false)

  useEffect(() => {
    setCapture(normalizeCompanyLetterheadCapture(job.assessment_data?.company_letterhead))
  }, [job.id, job.updated_at])

  const isDirty = !capturesEqual(capture, saved)
  useRegisterUnsavedChanges('company-letterhead', isDirty)

  function patch(next: Partial<CompanyLetterheadCapture>) {
    setCapture(prev => ({ ...prev, ...next }))
    setError('')
  }

  async function save(next = capture): Promise<boolean> {
    setSaving(true)
    setError('')
    try {
      const merged = mergeAssessmentData(job.assessment_data)
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessment_data: { ...merged, company_letterhead: next },
        }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !data.job) throw new Error(data.error || 'Could not save the letter')
      onJobUpdate(data.job)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the letter')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function uploadFiles(list: FileList | null) {
    const files = Array.from(list ?? []).filter(file => file.type.startsWith('image/'))
    if (fileRef.current) fileRef.current.value = ''
    if (files.length === 0) return
    const room = MAX_IMAGES - capture.images.length
    if (room <= 0) {
      setError(`This letter can include ${MAX_IMAGES} images.`)
      return
    }
    setUploading(true)
    setError('')
    const added: CompanyLetterheadImage[] = []
    try {
      for (const file of files.slice(0, room)) {
        const blob = await compressImage(file)
        const body = new FormData()
        body.set('file', new File([blob], 'letter.jpg', { type: 'image/jpeg' }))
        const res = await fetch(`/api/jobs/${job.id}/letterhead-image`, { method: 'POST', body })
        const data = (await res.json()) as { url?: string; error?: string }
        if (!res.ok || !data.url) throw new Error(data.error || 'Could not attach that image')
        added.push({ id: crypto.randomUUID(), url: data.url, caption: '' })
      }
      const next: CompanyLetterheadCapture = {
        ...capture,
        images: [...capture.images, ...added].slice(0, MAX_IMAGES),
      }
      setCapture(next)
      await save(next)
    } catch (e) {
      if (added.length > 0) {
        const next: CompanyLetterheadCapture = {
          ...capture,
          images: [...capture.images, ...added].slice(0, MAX_IMAGES),
        }
        setCapture(next)
        await save(next)
      }
      setError(e instanceof Error ? e.message : 'Could not attach that image')
    } finally {
      setUploading(false)
    }
  }

  function updateCaption(id: string, caption: string) {
    patch({
      images: capture.images.map(image => (image.id === id ? { ...image, caption } : image)),
    })
  }

  async function removeImage(id: string) {
    const next = { ...capture, images: capture.images.filter(image => image.id !== id) }
    setCapture(next)
    await save(next)
  }

  async function draft() {
    if (!prompt.trim() || drafting) return
    const hasBody = proseHasPrintableContent(capture.body_html)
    if (hasBody && !window.confirm('Replace the letter with a new draft? Your current text is sent with the brief so it can be revised.')) return
    setDrafting(true)
    setError('')
    try {
      const res = await fetch(`/api/jobs/${job.id}/suggest-letterhead-body`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, existing_html: hasBody ? capture.body_html : undefined }),
      })
      const data = (await res.json()) as { body_html?: string; error?: string }
      if (!res.ok || !data.body_html) throw new Error(data.error || 'Could not draft the letter')
      patch({ body_html: data.body_html })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not draft the letter')
    } finally {
      setDrafting(false)
    }
  }

  async function generate() {
    if (!companyLetterheadHasContent(capture)) {
      setError('Write the letter, or attach an image, before generating the document.')
      return
    }
    const ok = await save()
    if (ok) router.push(`/jobs/${job.id}/docs/company_letterhead?compose=1`)
  }

  return (
    <div style={{ paddingBottom: 96 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px' }}>Company Letterhead</h2>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, margin: '0 0 16px' }}>
        Write the letter in the box. Your company letterhead is added when the document is generated. Attach images to include them on the letter.
      </p>

      <div
        style={{
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          borderRadius: 12,
          padding: 14,
          display: 'grid',
          gap: 10,
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Draft with AI
        </div>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void draft()
            }
          }}
          placeholder="e.g. Short report for the property manager confirming the bathroom was cleaned and deodorised, with a recommendation to replace the vanity."
          rows={3}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface-2)',
            color: 'var(--text)',
            fontSize: 14,
            lineHeight: 1.5,
            resize: 'vertical',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!prompt.trim() || drafting || saving}
            onClick={() => void draft()}
            style={{ fontWeight: 700 }}
          >
            {drafting ? 'Drafting…' : proseHasPrintableContent(capture.body_html) ? 'Redraft' : 'Draft'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Uses the job details, Scope of Work, and progress notes. Check the draft before you generate.
          </span>
        </div>
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
        Letter
      </div>
      <RichTextEditor
        value={capture.body_html}
        onChange={body_html => patch({ body_html: proseHasPrintableContent(body_html) ? body_html : '' })}
        minHeight={320}
      />

      <div style={{ marginTop: 22 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
          Images
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 12px' }}>
          These images print on this letter. They stay off the job photo library.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={e => void uploadFiles(e.target.files)}
        />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={uploading || saving || capture.images.length >= MAX_IMAGES}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Attaching…' : 'Attach images'}
        </button>
        {capture.images.length > 0 && (
          <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
            {capture.images.map(image => (
              <div
                key={image.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '96px 1fr',
                  gap: 12,
                  alignItems: 'start',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 10,
                  background: 'var(--surface)',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt={image.caption || 'Attached image'} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, background: 'var(--surface-2)' }} />
                <div style={{ display: 'grid', gap: 8 }}>
                  <input
                    value={image.caption}
                    onChange={e => updateCaption(image.id, e.target.value)}
                    placeholder="Caption (optional)"
                    aria-label="Image caption"
                    maxLength={240}
                    style={{
                      width: '100%',
                      fontSize: 14,
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--surface-2)',
                      color: 'var(--text)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void removeImage(image.id)}
                    disabled={saving || uploading}
                    style={{
                      justifySelf: 'start',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#F87171',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 25,
          background: 'var(--bg)',
          borderTop: '1px solid var(--border)',
          padding: '10px 16px max(12px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          {error && (
            <div style={{ color: '#F87171', fontSize: 13, marginBottom: 8 }} role="alert">
              {error}
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || uploading || drafting}
            onClick={() => void generate()}
            style={{ width: '100%', padding: 12, fontWeight: 700 }}
          >
            {saving ? 'Saving…' : 'Generate document'}
          </button>
        </div>
      </div>
    </div>
  )
}
