/*
 * app/inventory/page.tsx
 *
 * Inventory Manager — shell for the ETCC module (Equipment, Tools, Consumables,
 * Chemicals). Secondary tab bar switches between the four sub-areas; each is a
 * placeholder until the feature is built. Active tab persists in `?tab=` so
 * refresh and deep links restore the right panel (same pattern as /jobs/[id]).
 *
 * Planned scope (for context, not yet implemented):
 *   - Equipment: durable items (vacuums, ozone units, PPE kits, trailers).
 *   - Tools: reusable hand/power tools issued to technicians.
 *   - Consumables: bags, wipes, filters, liners — deducted per job.
 *   - Chemicals: SDS-tracked products with expiry, batch, and storage rules.
 */
'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type InventoryTab = 'equipment' | 'tools' | 'consumables' | 'chemicals'

interface TabDef {
  id: InventoryTab
  label: string
  icon: string
  description: string
}

const TABS: TabDef[] = [
  {
    id: 'equipment',
    label: 'Equipment',
    icon: '🧰',
    description: 'Durable items — vacuums, ozone units, PPE kits, trailers.',
  },
  {
    id: 'tools',
    label: 'Tools',
    icon: '🔧',
    description: 'Reusable hand and power tools issued to technicians.',
  },
  {
    id: 'consumables',
    label: 'Consumables',
    icon: '📦',
    description: 'Bags, wipes, filters, liners — deducted per job.',
  },
  {
    id: 'chemicals',
    label: 'Chemicals',
    icon: '⚗️',
    description: 'SDS-tracked products with expiry, batch, and storage rules.',
  },
]

const TAB_IDS = TABS.map(t => t.id) as InventoryTab[]
const DEFAULT_TAB: InventoryTab = 'equipment'

function isInventoryTab(v: string | null): v is InventoryTab {
  return !!v && (TAB_IDS as string[]).includes(v)
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<InventoryShell activeTab={DEFAULT_TAB} onTabChange={() => {}} />}>
      <InventoryPageInner />
    </Suspense>
  )
}

function InventoryPageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const urlTab = searchParams.get('tab')
  const initialTab: InventoryTab = isInventoryTab(urlTab) ? urlTab : DEFAULT_TAB
  const [activeTab, setActiveTab] = useState<InventoryTab>(initialTab)

  useEffect(() => {
    if (isInventoryTab(urlTab) && urlTab !== activeTab) setActiveTab(urlTab)
  }, [urlTab, activeTab])

  const handleTabChange = useCallback(
    (next: InventoryTab) => {
      setActiveTab(next)
      const params = new URLSearchParams(searchParams.toString())
      if (next === DEFAULT_TAB) params.delete('tab')
      else params.set('tab', next)
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  return <InventoryShell activeTab={activeTab} onTabChange={handleTabChange} />
}

function InventoryShell({
  activeTab,
  onTabChange,
}: {
  activeTab: InventoryTab
  onTabChange: (next: InventoryTab) => void
}) {
  const active = useMemo(() => TABS.find(t => t.id === activeTab) ?? TABS[0], [activeTab])

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
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
        Equipment, tools, consumables &amp; chemicals
      </div>

      <div
        role="tablist"
        aria-label="Inventory sections"
        style={{
          display: 'flex',
          gap: 4,
          padding: 4,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          marginBottom: 20,
          overflowX: 'auto',
          maxWidth: 720,
        }}
      >
        {TABS.map(tab => {
          const isActive = tab.id === activeTab
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`inv-panel-${tab.id}`}
              id={`inv-tab-${tab.id}`}
              onClick={() => onTabChange(tab.id)}
              style={tabButtonStyle(isActive)}
            >
              <span aria-hidden style={{ fontSize: 13 }}>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      <section
        role="tabpanel"
        id={`inv-panel-${active.id}`}
        aria-labelledby={`inv-tab-${active.id}`}
        style={{
          background: 'var(--surface)',
          border: '1px dashed var(--border)',
          borderRadius: 16,
          padding: '28px 22px',
          maxWidth: 520,
        }}
      >
        <div style={{ fontSize: 30, marginBottom: 10 }}>{active.icon}</div>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
          {active.label} — coming soon
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, margin: 0 }}>
          {active.description}
        </p>
      </section>
    </div>
  )
}

function tabButtonStyle(isActive: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid ' + (isActive ? 'var(--border-2)' : 'transparent'),
    background: isActive ? 'var(--surface)' : 'transparent',
    color: isActive ? 'var(--text)' : 'var(--text-muted)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background 0.15s ease, color 0.15s ease',
  }
}
