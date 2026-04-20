/*
 * app/inventory/page.tsx
 *
 * Inventory Manager — shell for the ETCC module (Equipment, Tools, Consumables,
 * Chemicals). This is an intentional placeholder: the feature is wired into the
 * dashboard tile so the route resolves, but the module itself has not been
 * built yet. When we start implementing it, this file is where work begins.
 *
 * Planned scope (for context, not yet implemented):
 *   - Equipment: durable items (vacuums, ozone units, PPE kits, trailers).
 *   - Tools: reusable hand/power tools issued to technicians.
 *   - Consumables: bags, wipes, filters, liners — deducted per job.
 *   - Chemicals: SDS-tracked products with expiry, batch, and storage rules.
 */
'use client'

import Link from 'next/link'

export default function InventoryPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        padding: '24px 20px 40px',
      }}
    >
      <Link
        href="/"
        style={{
          fontSize: 13,
          color: 'var(--text-muted)',
          textDecoration: 'none',
          display: 'inline-block',
          marginBottom: 20,
        }}
      >
        ← Dashboard
      </Link>

      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 6 }}>
        Inventory Manager
      </h1>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
        Equipment, tools, consumables &amp; chemicals
      </div>

      <div
        style={{
          background: 'var(--surface)',
          border: '1px dashed var(--border)',
          borderRadius: 16,
          padding: '28px 22px',
          maxWidth: 520,
        }}
      >
        <div style={{ fontSize: 30, marginBottom: 10 }}>📦</div>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Coming soon</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, margin: 0 }}>
          This is where you&apos;ll track equipment, tools, consumables and chemicals — check
          items in and out of jobs, monitor stock levels, and manage SDS records.
        </p>
      </div>
    </div>
  )
}
