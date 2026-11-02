'use client'

import { useEffect, useState } from 'react'
import { ScreenBar } from '@/components/records/ScreenBar'
import { addDaysYmd, brisbaneStamp, brisbaneWeekStart } from '@/lib/jobRecords'

interface Row {
  id: string
  job_number: string
  address: string
  clock_on_at: string
  clock_off_at: string | null
  hours: number | null
}

export default function TimesheetPage() {
  const [week, setWeek] = useState(brisbaneWeekStart(new Date()))
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/tech/timesheet?week=${week}`)
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not load the timesheet.')
        setRows(data.rows ?? [])
        setTotal(data.total_hours ?? 0)
        setError('')
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load the timesheet.'))
  }, [week])

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)' }}>
      <ScreenBar title="Timesheet" sub={`Week of ${week}`} back="/tech" />
      <div style={{ maxWidth: 680, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setWeek(addDaysYmd(week, -7))} style={nav}>Previous</button>
          <button type="button" onClick={() => setWeek(addDaysYmd(week, 7))} style={nav}>Next</button>
        </div>
        {error && <p style={{ color: '#F87171' }}>{error}</p>}
        {rows.map(row => (
          <div key={row.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 14 }}>
            <div style={{ fontWeight: 800 }}>{row.job_number}</div>
            <div>{row.address}</div>
            <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
              {brisbaneStamp(new Date(row.clock_on_at))}
              {row.clock_off_at ? ` – ${brisbaneStamp(new Date(row.clock_off_at))}` : ' · still clocked on'}
            </div>
            <div style={{ fontWeight: 800, marginTop: 4 }}>{row.hours == null ? '—' : `${row.hours} h`}</div>
          </div>
        ))}
        <div style={{ fontWeight: 800, fontSize: 20 }}>Week total {total} h</div>
      </div>
    </div>
  )
}

const nav = { flex: 1, minHeight: 52, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 800 } as const
