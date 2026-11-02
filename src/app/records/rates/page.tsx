'use client'

import { useEffect, useState } from 'react'
import { ScreenBar, bigButton, fieldStyle } from '@/components/records/ScreenBar'
import type { RateCard } from '@/lib/jobRecords'

const FIELDS: { key: keyof RateCard; label: string }[] = [
  { key: 'biohazard_cents', label: 'Biohazard, per callout ($)' },
  { key: 'meth_cents', label: 'Meth testing, per callout ($)' },
  { key: 'mould_cents', label: 'Mould testing, per callout ($)' },
  { key: 'hoarding_cents_per_m3', label: 'Hoarding, per m³ ($)' },
  { key: 'squalor_cents_per_m2', label: 'Squalor, per m² ($)' },
]

export default function RatesPage() {
  const [dollars, setDollars] = useState<Record<keyof RateCard, string> | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    fetch('/api/records/rates')
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not load rates.')
        const rates = data.rates as RateCard
        setDollars({
          biohazard_cents: (rates.biohazard_cents / 100).toFixed(2),
          meth_cents: (rates.meth_cents / 100).toFixed(2),
          mould_cents: (rates.mould_cents / 100).toFixed(2),
          hoarding_cents_per_m3: (rates.hoarding_cents_per_m3 / 100).toFixed(2),
          squalor_cents_per_m2: (rates.squalor_cents_per_m2 / 100).toFixed(2),
        })
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load rates.'))
  }, [])

  async function save() {
    if (!dollars) return
    setError('')
    setSaved('')
    const body = Object.fromEntries(FIELDS.map(field => [field.key, Math.round(Number(dollars[field.key]) * 100)]))
    const res = await fetch('/api/records/rates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error ?? 'Could not save rates.')
      return
    }
    setSaved('Saved.')
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)' }}>
      <ScreenBar title="Rates" sub="Bonus amounts" back="/records" />
      <div style={{ maxWidth: 680, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <p style={{ margin: 0, color: '#F87171' }}>{error}</p>}
        {saved && <p style={{ margin: 0, color: '#10B981' }}>{saved}</p>}
        {dollars && FIELDS.map(field => (
          <label key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontWeight: 700 }}>
            {field.label}
            <input value={dollars[field.key]} onChange={e => setDollars({ ...dollars, [field.key]: e.target.value })} inputMode="decimal" style={fieldStyle} />
          </label>
        ))}
        <button type="button" onClick={save} style={bigButton}>Save rates</button>
      </div>
    </div>
  )
}
