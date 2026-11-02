'use client'

import { useState } from 'react'
import { ScreenBar, bigButton, fieldStyle } from '@/components/records/ScreenBar'
import { brisbaneMonth, brisbaneWeekStart } from '@/lib/jobRecords'

export default function ExportsPage() {
  const [week, setWeek] = useState(brisbaneWeekStart(new Date()))
  const [month, setMonth] = useState(brisbaneMonth(new Date()))

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)' }}>
      <ScreenBar title="Exports" back="/records" />
      <div style={{ maxWidth: 680, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8, fontWeight: 700 }}>
          Timesheet week starting
          <input type="date" value={week} onChange={e => setWeek(e.target.value)} style={fieldStyle} />
          <a href={`/api/records/exports?kind=timesheet&week=${week}`} style={linkStyle}>Download timesheets</a>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8, fontWeight: 700 }}>
          Bonus month
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={fieldStyle} />
          <a href={`/api/records/exports?kind=bonus&month=${month}`} style={linkStyle}>Download bonus statement</a>
        </label>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>CSV for payroll. Records stay in the app.</p>
      </div>
    </div>
  )
}

const linkStyle = {
  ...bigButton,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textDecoration: 'none',
}
