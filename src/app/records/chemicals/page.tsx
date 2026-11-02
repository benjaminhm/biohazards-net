'use client'

import { useEffect, useState } from 'react'
import { ScreenBar, bigButton, fieldStyle } from '@/components/records/ScreenBar'

interface Chemical {
  id: string
  name: string
  dwell_minutes: number
}

export default function ChemicalsPage() {
  const [rows, setRows] = useState<Chemical[]>([])
  const [name, setName] = useState('')
  const [dwell, setDwell] = useState('10')
  const [error, setError] = useState('')

  function load() {
    fetch('/api/records/chemicals')
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not load chemicals.')
        setRows(data.chemicals ?? [])
        setError('')
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load chemicals.'))
  }

  useEffect(() => { load() }, [])

  async function add() {
    setError('')
    const res = await fetch('/api/records/chemicals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, dwell_minutes: Number(dwell) }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error ?? 'Could not add that chemical.')
      return
    }
    setName('')
    load()
  }

  async function archive(id: string) {
    const res = await fetch(`/api/records/chemicals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archive: true }),
    })
    if (res.ok) load()
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)' }}>
      <ScreenBar title="Chemicals" sub="Dwell time in minutes" back="/records" />
      <div style={{ maxWidth: 680, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <p style={{ margin: 0, color: '#F87171' }}>{error}</p>}
        {rows.map(row => (
          <div key={row.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800 }}>{row.name}</div>
              <div style={{ color: 'var(--text-muted)' }}>{row.dwell_minutes} min</div>
            </div>
            <button type="button" onClick={() => archive(row.id)} style={{ minHeight: 44, borderRadius: 12, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontWeight: 700 }}>Archive</button>
          </div>
        ))}
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Chemical name" aria-label="Chemical name" style={fieldStyle} />
        <input value={dwell} onChange={e => setDwell(e.target.value)} type="number" min={0} placeholder="Dwell minutes" aria-label="Dwell minutes" style={fieldStyle} />
        <button type="button" onClick={add} style={bigButton}>Add chemical</button>
      </div>
    </div>
  )
}
