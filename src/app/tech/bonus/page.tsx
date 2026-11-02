'use client'

import { useEffect, useState } from 'react'
import { ScreenBar, fieldStyle } from '@/components/records/ScreenBar'
import { brisbaneMonth, dollars } from '@/lib/jobRecords'

interface Row {
  id: string
  job_number: string
  address: string
  job_type_label: string
  status: 'pending' | 'earned' | 'not_earned'
  reason: string
  cents: number
  technician_comment: string | null
}

export default function BonusPage() {
  const [month, setMonth] = useState(brisbaneMonth(new Date()))
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  function load(next = month) {
    fetch(`/api/tech/bonus?month=${next}`)
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not load the statement.')
        setRows(data.rows ?? [])
        setTotal(data.total_cents ?? 0)
        setError('')
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load the statement.'))
  }

  useEffect(() => { load(month) }, [month])

  function shift(delta: number) {
    const [year, mon] = month.split('-').map(Number)
    const date = new Date(Date.UTC(year, mon - 1 + delta, 1))
    setMonth(date.toISOString().slice(0, 7))
  }

  async function comment(jobId: string) {
    setError('')
    const res = await fetch(`/api/tech/jobs/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'comment', body: drafts[jobId] ?? '' }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error ?? 'Could not save the comment.')
      return
    }
    load()
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)' }}>
      <ScreenBar title="Bonus" sub={month} back="/tech" />
      <div style={{ maxWidth: 680, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => shift(-1)} style={nav}>Previous</button>
          <button type="button" onClick={() => shift(1)} style={nav}>Next</button>
        </div>
        {error && <p style={{ color: '#F87171' }}>{error}</p>}
        {rows.map(row => (
          <div key={row.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 14 }}>
            <div style={{ fontWeight: 800 }}>{row.job_number} · {row.job_type_label}</div>
            <div>{row.address}</div>
            <div style={{ marginTop: 6, fontWeight: 800 }}>{row.status.replace('_', ' ')} · {dollars(row.cents)}</div>
            {row.reason && <div style={{ color: 'var(--text-muted)' }}>{row.reason}</div>}
            {row.status === 'not_earned' && (
              <>
                <textarea value={drafts[row.id] ?? row.technician_comment ?? ''} onChange={e => setDrafts({ ...drafts, [row.id]: e.target.value })} placeholder="Explain this" aria-label="Comment" style={{ ...fieldStyle, minHeight: 80, marginTop: 8 }} />
                <button type="button" onClick={() => comment(row.id)} style={{ ...nav, width: '100%', marginTop: 8 }}>Save comment</button>
              </>
            )}
          </div>
        ))}
        <div style={{ fontWeight: 800, fontSize: 22 }}>Month total {dollars(total)}</div>
      </div>
    </div>
  )
}

const nav = { flex: 1, minHeight: 52, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 800 } as const
