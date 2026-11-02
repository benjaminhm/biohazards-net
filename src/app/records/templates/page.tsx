'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { ScreenBar, bigButton, fieldStyle } from '@/components/records/ScreenBar'
import { STEP_TYPES, type StepType } from '@/lib/jobRecords'

interface TemplateStep {
  id: string
  title: string
  instruction: string
  step_type: StepType
  required: boolean
  min_photos: number
  checklist_items: string[]
}

interface TemplateGroup {
  job_type: string
  label: string
  steps: TemplateStep[]
}

const empty = {
  title: '',
  instruction: '',
  step_type: 'photo' as StepType,
  required: true,
  min_photos: 1,
  checklist: '',
}

export default function TemplatesPage() {
  const [groups, setGroups] = useState<TemplateGroup[]>([])
  const [type, setType] = useState('biohazard')
  const [form, setForm] = useState(empty)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function load() {
    fetch('/api/records/templates')
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not load templates.')
        setGroups(data.templates ?? [])
        setError('')
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load templates.'))
  }

  useEffect(() => { load() }, [])

  const group = groups.find(item => item.job_type === type)

  async function addStep() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/records/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_type: type,
          ...form,
          checklist_items: form.checklist.split('\n').map(line => line.trim()).filter(Boolean),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not add that step.')
      setForm(empty)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that step.')
    } finally {
      setSaving(false)
    }
  }

  async function move(index: number, direction: -1 | 1) {
    if (!group) return
    const ids = group.steps.map(step => step.id)
    const next = index + direction
    if (next < 0 || next >= ids.length) return
    const [item] = ids.splice(index, 1)
    ids.splice(next, 0, item)
    const res = await fetch('/api/records/templates/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_type: type, ids }),
    })
    if (res.ok) load()
  }

  async function remove(id: string) {
    const res = await fetch(`/api/records/templates/${id}`, { method: 'DELETE' })
    if (res.ok) load()
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', paddingBottom: 32 }}>
      <ScreenBar title="Templates" back="/records" />
      <div style={{ maxWidth: 680, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {groups.map(item => (
            <button key={item.job_type} type="button" onClick={() => setType(item.job_type)} style={{ minHeight: 44, borderRadius: 12, border: '1px solid var(--border)', background: item.job_type === type ? 'var(--accent)' : 'var(--surface)', color: item.job_type === type ? '#fff' : 'var(--text)', fontWeight: 700, padding: '0 12px' }}>
              {item.label}
            </button>
          ))}
        </div>
        {error && <p style={{ margin: 0, color: '#F87171' }}>{error}</p>}
        {(group?.steps ?? []).map((step, index) => (
          <div key={step.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 14 }}>
            <div style={{ fontWeight: 800 }}>{index + 1}. {step.title}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{step.step_type}{step.required ? ' · required' : ' · optional'}{step.step_type === 'photo' ? ` · ${step.min_photos} photos` : ''}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" onClick={() => move(index, -1)} style={mini}>Up</button>
              <button type="button" onClick={() => move(index, 1)} style={mini}>Down</button>
              <button type="button" onClick={() => remove(step.id)} style={mini}>Archive</button>
            </div>
          </div>
        ))}
        <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Step title" aria-label="Step title" style={fieldStyle} />
        <input value={form.instruction} onChange={e => setForm({ ...form, instruction: e.target.value })} placeholder="Short instruction" aria-label="Instruction" style={fieldStyle} />
        <select value={form.step_type} onChange={e => setForm({ ...form, step_type: e.target.value as StepType })} aria-label="Step type" style={fieldStyle}>
          {STEP_TYPES.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={form.required} onChange={e => setForm({ ...form, required: e.target.checked })} />
          Required
        </label>
        {form.step_type === 'photo' && (
          <input type="number" min={1} value={form.min_photos} onChange={e => setForm({ ...form, min_photos: Number(e.target.value) })} aria-label="Minimum photos" style={fieldStyle} />
        )}
        {form.step_type === 'checklist' && (
          <textarea value={form.checklist} onChange={e => setForm({ ...form, checklist: e.target.value })} placeholder="One checklist item per line" aria-label="Checklist items" style={{ ...fieldStyle, minHeight: 100 }} />
        )}
        <button type="button" disabled={saving} onClick={addStep} style={bigButton}>{saving ? 'Adding…' : 'Add step'}</button>
      </div>
    </div>
  )
}

const mini: CSSProperties = {
  minHeight: 40,
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  fontWeight: 700,
}
