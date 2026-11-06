'use client'

import { useState, type CSSProperties } from 'react'

/** A number field that shows `fallback` while `value` is blank. Clearing it goes back to the fallback. */
export default function DefaultedNumberInput({
  value,
  fallback,
  step,
  onChange,
  style,
}: {
  value: number | null | undefined
  fallback: number | null | undefined
  step: string
  onChange: (next: number | null) => void
  style: CSSProperties
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(value ?? fallback ?? '')
  return (
    <input
      type="number"
      min={0}
      step={step}
      value={shown}
      onFocus={() => setDraft(shown)}
      onChange={e => {
        const raw = e.target.value
        setDraft(raw)
        onChange(raw === '' ? null : Number(raw))
      }}
      onBlur={() => setDraft(null)}
      placeholder="0"
      style={style}
    />
  )
}
