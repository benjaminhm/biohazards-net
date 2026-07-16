/*
 * Blocking prompt: which trading name is this job operating under?
 * Required once per job; can be reopened from Client Details to change.
 */
'use client'

import { useState } from 'react'
import {
  TRADING_NAME_OPTIONS,
  type TradingNameId,
} from '@/lib/tradingNames'

interface Props {
  clientLabel?: string
  initialValue?: TradingNameId | null
  /** When true, backdrop / cancel is allowed (change flow). First-time select is blocking. */
  allowDismiss?: boolean
  onSave: (tradingName: TradingNameId) => Promise<void>
  onCancel?: () => void
}

export default function TradingNameModal({
  clientLabel,
  initialValue = null,
  allowDismiss = false,
  onSave,
  onCancel,
}: Props) {
  const [selected, setSelected] = useState<TradingNameId | null>(initialValue)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    if (!selected) return
    setSaving(true)
    setError('')
    try {
      await onSave(selected)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save trading name')
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trading-name-title"
      onClick={e => {
        if (allowDismiss && e.target === e.currentTarget) onCancel?.()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 220,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: 16,
          padding: '24px 22px 20px',
          width: '100%',
          maxWidth: 440,
          border: '1px solid var(--border)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
        }}
      >
        <div
          id="trading-name-title"
          style={{ fontWeight: 700, fontSize: 18, marginBottom: 8, color: 'var(--text)' }}
        >
          Who are you trading as?
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
          Choose the trading name for
          {clientLabel ? (
            <>
              {' '}
              <strong style={{ color: 'var(--text)' }}>{clientLabel}</strong>
            </>
          ) : (
            ' this job'
          )}
          . It appears on quotes, letters, and other composed documents. ABN and
          address stay the same; Forensic Cleaning QLD uses its own email.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
          {TRADING_NAME_OPTIONS.map(opt => {
            const active = selected === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelected(opt.id)}
                style={{
                  textAlign: 'left',
                  padding: '14px 16px',
                  borderRadius: 12,
                  border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: active ? 'rgba(255,107,53,0.08)' : 'var(--surface-2)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 15 }}>{opt.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {[
                    opt.email ? `Email: ${opt.email}` : 'Email from Settings',
                    opt.useWordmark ? 'Text wordmark (no image logo yet)' : 'Logo from Settings',
                  ].join(' · ')}
                </div>
              </button>
            )
          })}
        </div>

        {error && (
          <div style={{ fontSize: 13, color: '#F87171', marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          {allowDismiss && (
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              style={{
                flex: 1,
                padding: 13,
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'none',
                color: 'var(--text)',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selected || saving}
            className="btn btn-primary"
            style={{
              flex: allowDismiss ? 2 : 1,
              padding: 13,
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 14,
              opacity: !selected || saving ? 0.5 : 1,
              cursor: !selected || saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
