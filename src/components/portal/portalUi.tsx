/*
 * components/portal/portalUi.tsx
 *
 * Shared presentation for the commercial accounts portal.
 *
 * Client-facing surfaces in this app use inline styles on a light theme with the
 * #FF6B35 brand accent (see app/accept/[jobId]/page.tsx). These primitives keep
 * that consistent across the portal without repeating style objects on every page.
 */
'use client'

import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'

export const BRAND = '#FF6B35'
export const INK = '#111111'
export const MUTED = '#6B7280'
export const LINE = '#E5E7EB'
export const SURFACE = '#FFFFFF'
export const CANVAS = '#F5F5F5'

export const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

export const page: CSSProperties = {
  minHeight: '100vh',
  background: CANVAS,
  fontFamily: FONT,
  color: INK,
}

export const container: CSSProperties = {
  maxWidth: 880,
  margin: '0 auto',
  padding: '0 20px 72px',
}

export const narrow: CSSProperties = {
  maxWidth: 460,
  margin: '0 auto',
  padding: '0 20px 72px',
}

export const card: CSSProperties = {
  background: SURFACE,
  border: `1px solid ${LINE}`,
  borderRadius: 12,
  padding: 24,
}

export const eyebrow: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: BRAND,
}

export const h1: CSSProperties = {
  fontSize: 26,
  fontWeight: 700,
  margin: '8px 0 0',
  letterSpacing: '-0.01em',
}

export const h2: CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  margin: 0,
}

export const label: CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: MUTED,
  marginBottom: 6,
}

export const input: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 14px',
  fontSize: 15,
  fontFamily: FONT,
  color: INK,
  background: SURFACE,
  border: `1px solid ${LINE}`,
  borderRadius: 8,
  outline: 'none',
}

export const meta: CSSProperties = {
  fontSize: 13,
  color: MUTED,
  lineHeight: 1.6,
}

export function buttonStyle(
  variant: 'primary' | 'secondary' = 'primary',
  disabled = false
): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '13px 24px',
    fontSize: 15,
    fontWeight: 700,
    fontFamily: FONT,
    borderRadius: 8,
    border: '1px solid transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    textDecoration: 'none',
  }
  if (variant === 'primary') {
    return { ...base, background: BRAND, color: '#FFFFFF' }
  }
  return { ...base, background: SURFACE, color: INK, borderColor: LINE }
}

export function PortalHeader({
  brandLabel,
  accountName,
  right,
}: {
  brandLabel: string
  accountName?: string
  right?: ReactNode
}) {
  return (
    <header style={{ background: SURFACE, borderBottom: `1px solid ${LINE}`, marginBottom: 28 }}>
      <div
        style={{
          ...container,
          padding: '18px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <div style={eyebrow}>{brandLabel}</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>
            {accountName ?? 'Trade account'}
          </div>
        </div>
        {right}
      </div>
    </header>
  )
}

export function PortalNav({ current }: { current: string }) {
  const items: Array<{ href: string; label: string }> = [
    { href: '/portal', label: 'Overview' },
    { href: '/portal/company', label: 'Company profile' },
    { href: '/portal/terms', label: 'Terms' },
  ]
  return (
    <nav style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}>
      {items.map(item => {
        const active = current === item.href
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              padding: '8px 14px',
              fontSize: 14,
              fontWeight: 600,
              borderRadius: 999,
              textDecoration: 'none',
              color: active ? '#FFFFFF' : INK,
              background: active ? INK : SURFACE,
              border: `1px solid ${active ? INK : LINE}`,
            }}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error' | 'success'
  children: ReactNode
}) {
  const palette = {
    info: { bg: '#F0F9FF', border: '#BAE6FD', text: '#0C4A6E' },
    warn: { bg: '#FFFBEB', border: '#FDE68A', text: '#78350F' },
    error: { bg: '#FEF2F2', border: '#FECACA', text: '#7F1D1D' },
    success: { bg: '#F0FDF4', border: '#BBF7D0', text: '#14532D' },
  }[tone]

  return (
    <div
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.text,
        borderRadius: 10,
        padding: '14px 16px',
        fontSize: 14,
        lineHeight: 1.6,
        marginBottom: 20,
      }}
    >
      {children}
    </div>
  )
}

export function Spinner({ message }: { message: string }) {
  return (
    <div
      style={{
        ...page,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: MUTED,
        fontSize: 14,
      }}
    >
      {message}
    </div>
  )
}

export function StatusPill({ label: text, tone }: { label: string; tone: 'neutral' | 'brand' | 'good' }) {
  const palette = {
    neutral: { bg: '#F3F4F6', text: '#374151' },
    brand: { bg: '#FFF1EB', text: '#9A3412' },
    good: { bg: '#F0FDF4', text: '#14532D' },
  }[tone]
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        background: palette.bg,
        color: palette.text,
      }}
    >
      {text}
    </span>
  )
}

export function DetailRow({ label: text, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={label}>{text}</div>
      <div style={{ fontSize: 15 }}>{value || <span style={{ color: MUTED }}>Not set</span>}</div>
    </div>
  )
}

export const money = (n: number | null | undefined) =>
  n == null
    ? '—'
    : `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const shortDate = (iso: string | null | undefined) =>
  !iso
    ? '—'
    : new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
