/*
 * components/ConfirmDeleteModal.tsx
 *
 * A slide-up bottom sheet that requires the user to type a specific name
 * before the destructive action is enabled. Used for deleting jobs, documents,
 * and team members where accidental deletion would be costly.
 *
 * The confirmName prop is typically the record's primary display name
 * (e.g. job reference or person's name) so users must consciously identify
 * what they are deleting rather than just clicking through a generic "Are you sure?".
 *
 * Match uses trimmed, whitespace-collapsed, NFC-normalized strings (case-insensitive)
 * so DB quirks (trailing spaces, NBSP) don’t block a correct confirmation.
 * The backdrop click cancels the modal so it behaves like a native sheet.
 */
'use client'

import { useState } from 'react'

interface Props {
  title: string
  description?: string
  confirmName: string       // exact name user must type
  onConfirm: () => Promise<void>
  onCancel: () => void
}

function normalizeConfirmInput(s: string) {
  return s.trim().replace(/\s+/g, ' ').normalize('NFC').toLowerCase()
}

export default function ConfirmDeleteModal({ title, description, confirmName, onConfirm, onCancel }: Props) {
  const [typed, setTyped]     = useState('')
  const [deleting, setDeleting] = useState(false)
  const match = normalizeConfirmInput(typed) === normalizeConfirmInput(confirmName)

  async function handleConfirm() {
    if (!match) return
    setDeleting(true)
    await onConfirm()
    setDeleting(false)
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: '20px 20px 0 0',
        padding: '24px 20px 44px', width: '100%', maxWidth: 480,
      }}>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
          {description ?? 'This action cannot be undone.'}
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
          Type <strong style={{ color: 'var(--text)' }}>{confirmName}</strong> to confirm
        </div>
        <input
          autoFocus
          value={typed}
          onChange={e => setTyped(e.target.value)}
          placeholder={confirmName}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 10, boxSizing: 'border-box',
            border: `1px solid ${match ? '#EF4444' : 'var(--border)'}`,
            background: 'var(--bg)', color: 'var(--text)', fontSize: 14, marginBottom: 16,
          }}
        />

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: 13, borderRadius: 10, border: '1px solid var(--border)',
              background: 'none', color: 'var(--text)', fontWeight: 600, fontSize: 14, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!match || deleting}
            style={{
              flex: 2, padding: 13, borderRadius: 10, border: 'none',
              background: match ? '#EF4444' : 'var(--surface-2)',
              color: match ? '#fff' : 'var(--text-muted)',
              fontWeight: 700, fontSize: 14,
              cursor: match ? 'pointer' : 'not-allowed',
              transition: 'background 0.2s, color 0.2s',
            }}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
