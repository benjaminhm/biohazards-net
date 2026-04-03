/*
 * app/site/CallbackForm.tsx
 *
 * Client component — interactive callback request form on the public website.
 * Submits to POST /api/public/callback with name, phone, and org slug.
 * Shows a success state after submission so the user knows it went through.
 * No page reload required.
 */
'use client'

import { useState } from 'react'

export default function CallbackForm({ slug }: { slug: string }) {
  const [name, setName]     = useState('')
  const [phone, setPhone]   = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone]     = useState(false)
  const [error, setError]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !phone.trim()) return
    setLoading(true)
    setError(false)
    try {
      await fetch('/api/public/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), slug }),
      })
      setDone(true)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div style={{
        background: '#fff', border: '1px solid #e8e8e8',
        borderRadius: 14, padding: '40px 32px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 44, marginBottom: 16 }}>✓</div>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8, color: '#111' }}>
          Request received
        </div>
        <div style={{ fontSize: 14, color: '#666', lineHeight: 1.6 }}>
          We&apos;ll call you back as soon as possible. All enquiries are treated with complete discretion.
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input
        type="text"
        placeholder="Your name"
        value={name}
        onChange={e => setName(e.target.value)}
        required
        style={{
          padding: '14px 16px', borderRadius: 10, fontSize: 15,
          border: '1px solid #e0e0e0', background: '#fff',
          color: '#111', outline: 'none', width: '100%',
          boxSizing: 'border-box',
        }}
      />
      <input
        type="tel"
        placeholder="Your phone number"
        value={phone}
        onChange={e => setPhone(e.target.value)}
        required
        style={{
          padding: '14px 16px', borderRadius: 10, fontSize: 15,
          border: '1px solid #e0e0e0', background: '#fff',
          color: '#111', outline: 'none', width: '100%',
          boxSizing: 'border-box',
        }}
      />
      {error && (
        <div style={{ fontSize: 13, color: '#EF4444' }}>
          Something went wrong — please call us directly.
        </div>
      )}
      <button
        type="submit"
        disabled={loading}
        style={{
          padding: '15px', borderRadius: 10, border: 'none',
          background: '#FF6B35', color: '#fff',
          fontWeight: 800, fontSize: 16, cursor: 'pointer',
          opacity: loading ? 0.7 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        {loading ? 'Sending…' : 'Call Me Back'}
      </button>
      <p style={{ fontSize: 12, color: '#aaa', margin: 0 }}>
        Your details are kept strictly confidential.
      </p>
    </form>
  )
}
