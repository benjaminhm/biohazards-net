/*
 * components/settings/ChemicalsCatalogueSection.tsx
 *
 * Org-level chemicals catalogue editor mounted on /settings.
 *
 * Source of truth: company_profile.chemicals_catalogue (see /api/company/chemicals).
 * The catalogue feeds the Assessment → Chemicals checklist on every job.
 *
 * Extras vs the equipment catalogue:
 *  - Each item may have an attached SDS PDF (sds_path in company-assets bucket)
 *    plus a parsed SDS summary (signal word, PPE, first aid, handling).
 *  - Add flow supports optional SDS upload → /api/company/chemicals/parse-sds
 *    pre-fills name, manufacturer, active ingredient, hazard classes.
 *  - Existing items have "Attach SDS" / "Replace SDS" and "Clear SDS" controls.
 *  - Archive is soft-delete so historical job references resolve.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import {
  CHEMICAL_HAZARD_CLASS_LABELS,
  type ChemicalCatalogueItem,
  type ChemicalHazardClass,
  type SdsParsed,
} from '@/lib/types'

const HAZARD_CLASSES = Object.keys(CHEMICAL_HAZARD_CLASS_LABELS) as ChemicalHazardClass[]

const HAZARD_THEME: Record<ChemicalHazardClass, { bg: string; border: string; color: string }> = {
  corrosive:      { bg: 'rgba(251, 146, 60, 0.18)', border: 'rgba(251, 146, 60, 0.45)', color: '#FDBA74' },
  flammable:      { bg: 'rgba(248, 113, 113, 0.18)', border: 'rgba(248, 113, 113, 0.45)', color: '#FCA5A5' },
  toxic:          { bg: 'rgba(167, 139, 250, 0.18)', border: 'rgba(167, 139, 250, 0.45)', color: '#C4B5FD' },
  oxidiser:       { bg: 'rgba(251, 191, 36, 0.18)',  border: 'rgba(251, 191, 36, 0.4)',   color: '#FCD34D' },
  biohazard:      { bg: 'rgba(244, 114, 182, 0.18)', border: 'rgba(244, 114, 182, 0.45)', color: '#F9A8D4' },
  irritant:       { bg: 'rgba(96, 165, 250, 0.18)',  border: 'rgba(96, 165, 250, 0.45)',  color: '#93C5FD' },
  health_hazard:  { bg: 'rgba(248, 113, 113, 0.14)', border: 'rgba(248, 113, 113, 0.35)', color: '#FCA5A5' },
  environmental:  { bg: 'rgba(52, 211, 153, 0.16)',  border: 'rgba(52, 211, 153, 0.4)',   color: '#6EE7B7' },
  compressed_gas: { bg: 'rgba(148, 163, 184, 0.18)', border: 'rgba(148, 163, 184, 0.4)',  color: '#CBD5E1' },
  other:          { bg: 'rgba(100, 116, 139, 0.2)',  border: 'rgba(100, 116, 139, 0.45)', color: '#94A3B8' },
}

type AddDraft = {
  name: string
  manufacturer: string
  active_ingredient: string
  hazard_classes: Set<ChemicalHazardClass>
  notes: string
  sds_path?: string
  sds_filename?: string
  sds_public_url?: string
  sds_parsed?: SdsParsed
}

const emptyDraft = (): AddDraft => ({
  name: '',
  manufacturer: '',
  active_ingredient: '',
  hazard_classes: new Set(),
  notes: '',
})

export default function ChemicalsCatalogueSection() {
  const [items, setItems] = useState<ChemicalCatalogueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<AddDraft>(emptyDraft())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachingSdsForId, setAttachingSdsForId] = useState<string | null>(null)
  const replaceFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/company/chemicals')
      .then(r => r.json())
      .then(d => {
        if (!cancelled) setItems(Array.isArray(d.items) ? d.items : [])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function parseSdsFile(file: File): Promise<{
    sds_path: string
    sds_filename: string
    sds_public_url?: string
    sds_parsed: SdsParsed
  }> {
    const form = new FormData()
    form.append('file', file)
    form.append('filename', file.name)
    const res = await fetch('/api/company/chemicals/parse-sds', {
      method: 'POST',
      body: form,
    })
    const data = (await res.json()) as {
      error?: string
      sds_path?: string
      sds_filename?: string
      sds_public_url?: string
      sds_parsed?: SdsParsed
    }
    if (!res.ok || !data.sds_parsed) throw new Error(data.error || 'SDS parse failed')
    return {
      sds_path: data.sds_path!,
      sds_filename: data.sds_filename!,
      sds_public_url: data.sds_public_url,
      sds_parsed: data.sds_parsed,
    }
  }

  async function onPickSdsForNew(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParsing(true)
    setError('')
    try {
      const result = await parseSdsFile(file)
      const p = result.sds_parsed
      setDraft(d => ({
        ...d,
        name: d.name || p.product_name,
        manufacturer: d.manufacturer || p.manufacturer || '',
        active_ingredient: d.active_ingredient || p.active_ingredient || '',
        hazard_classes: new Set([...d.hazard_classes, ...p.hazard_classes]),
        sds_path: result.sds_path,
        sds_filename: result.sds_filename,
        sds_public_url: result.sds_public_url,
        sds_parsed: result.sds_parsed,
      }))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'SDS parse failed')
    } finally {
      setParsing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function addItem() {
    const name = draft.name.trim()
    if (!name || saving) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/company/chemicals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          manufacturer: draft.manufacturer.trim() || undefined,
          active_ingredient: draft.active_ingredient.trim() || undefined,
          hazard_classes: Array.from(draft.hazard_classes),
          notes: draft.notes.trim() || undefined,
          sds_path: draft.sds_path,
          sds_filename: draft.sds_filename,
          sds_parsed: draft.sds_parsed,
        }),
      })
      const data = (await res.json()) as {
        items?: ChemicalCatalogueItem[]
        error?: string
      }
      if (!res.ok || data.error) throw new Error(data.error || 'Could not save')
      setItems(data.items ?? [])
      setDraft(emptyDraft())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function patchItem(id: string, patch: Partial<ChemicalCatalogueItem> & { clear_sds?: boolean }) {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/company/chemicals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      })
      const data = (await res.json()) as {
        items?: ChemicalCatalogueItem[]
        error?: string
      }
      if (!res.ok || data.error) throw new Error(data.error || 'Could not update')
      setItems(data.items ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not update')
    } finally {
      setSaving(false)
    }
  }

  async function archiveItem(id: string) {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/company/chemicals?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const data = (await res.json()) as { items?: ChemicalCatalogueItem[]; error?: string }
      if (!res.ok || data.error) throw new Error(data.error || 'Could not archive')
      setItems(data.items ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not archive')
    } finally {
      setSaving(false)
    }
  }

  async function onReplaceSds(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParsing(true)
    setAttachingSdsForId(id)
    setError('')
    try {
      const result = await parseSdsFile(file)
      await patchItem(id, {
        sds_path: result.sds_path,
        sds_filename: result.sds_filename,
        sds_parsed: result.sds_parsed,
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'SDS parse failed')
    } finally {
      setParsing(false)
      setAttachingSdsForId(null)
      if (replaceFileRef.current) replaceFileRef.current.value = ''
    }
  }

  const activeItems = items.filter(i => !i.archived)
  const archivedItems = items.filter(i => i.archived)
  const listToShow = showArchived ? archivedItems : activeItems

  const toggleHazardInDraft = (hc: ChemicalHazardClass) => {
    setDraft(d => {
      const next = new Set(d.hazard_classes)
      if (next.has(hc)) next.delete(hc)
      else next.add(hc)
      return { ...d, hazard_classes: next }
    })
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 6,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
            Chemicals catalogue
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Your team&apos;s chemicals with parsed SDS data. Feeds the Assessment → Chemicals checklist on every job.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowArchived(v => !v)}
          disabled={saving}
          style={{
            fontSize: 12, color: 'var(--text-muted)',
            background: 'none', border: 'none', textDecoration: 'underline',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {showArchived ? `Back to active (${activeItems.length})` : `Show archived (${archivedItems.length})`}
        </button>
      </div>

      {error && (
        <div
          style={{
            fontSize: 12,
            color: '#fecaca',
            border: '1px solid #7f1d1d',
            background: 'rgba(127,29,29,0.15)',
            padding: '8px 10px',
            borderRadius: 8,
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
      ) : listToShow.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 0' }}>
          {showArchived ? 'No archived chemicals.' : 'No chemicals yet. Use the form below to add your first product — drop in an SDS PDF to auto-fill most of the fields.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {listToShow.map(item => (
            <div
              key={item.id}
              style={{
                display: 'grid', gap: 4,
                padding: '10px 12px', borderRadius: 10,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{item.name}</span>
                {item.manufacturer && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {item.manufacturer}</span>
                )}
                {item.sds_parsed?.signal_word === 'danger' && <span style={signalPillStyle('danger')}>DANGER</span>}
                {item.sds_parsed?.signal_word === 'warning' && <span style={signalPillStyle('warning')}>WARNING</span>}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {item.sds_path && (
                    <a
                      href={`/api/company/chemicals/sds?path=${encodeURIComponent(item.sds_path)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={linkStyle}
                    >
                      View SDS
                    </a>
                  )}
                  <label style={linkStyle}>
                    {item.sds_path ? 'Replace SDS' : 'Attach SDS'}
                    <input
                      ref={attachingSdsForId === item.id ? replaceFileRef : undefined}
                      type="file"
                      accept="application/pdf"
                      style={{ display: 'none' }}
                      disabled={parsing || saving}
                      onChange={e => onReplaceSds(item.id, e)}
                    />
                  </label>
                  {item.sds_path && (
                    <button
                      type="button"
                      onClick={() => patchItem(item.id, { clear_sds: true })}
                      disabled={saving || parsing}
                      style={linkBtnStyle}
                    >
                      Clear SDS
                    </button>
                  )}
                  {!item.archived ? (
                    <button
                      type="button"
                      onClick={() => archiveItem(item.id)}
                      disabled={saving || parsing}
                      style={linkBtnStyle}
                    >
                      Archive
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => patchItem(item.id, { archived: false })}
                      disabled={saving || parsing}
                      style={linkBtnStyle}
                    >
                      Restore
                    </button>
                  )}
                </div>
              </div>

              {item.active_ingredient && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Active ingredient: <span style={{ color: 'var(--text)' }}>{item.active_ingredient}</span>
                </div>
              )}

              {item.hazard_classes.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {item.hazard_classes.map(hc => (
                    <span key={hc} style={hazardPillStyle(hc)}>
                      {CHEMICAL_HAZARD_CLASS_LABELS[hc]}
                    </span>
                  ))}
                </div>
              )}

              {item.sds_parsed?.ppe_required && item.sds_parsed.ppe_required.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  <strong style={{ color: 'var(--text)' }}>PPE:</strong> {item.sds_parsed.ppe_required.join(' · ')}
                </div>
              )}

              {item.sds_parsed?.handling_precautions && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  <strong style={{ color: 'var(--text)' }}>Handling:</strong> {item.sds_parsed.handling_precautions}
                </div>
              )}

              {item.notes && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  <strong style={{ color: 'var(--text)' }}>Notes:</strong> {item.notes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Add new ─────────────────────────────────────────── */}
      {!showArchived && (
        <div style={{ marginTop: 20, padding: 14, borderRadius: 10, border: '1px dashed var(--border)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--accent)', marginBottom: 10 }}>
            Add chemical
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10, alignItems: 'center' }}>
            <label style={{ ...linkStyle, padding: '8px 14px', borderRadius: 8, background: 'var(--bg)' }}>
              {parsing && !attachingSdsForId
                ? 'Parsing SDS…'
                : draft.sds_parsed
                  ? `SDS ready: ${draft.sds_filename}`
                  : '📎 Upload SDS PDF (auto-fill)'}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                style={{ display: 'none' }}
                disabled={parsing || saving}
                onChange={onPickSdsForNew}
              />
            </label>
            {draft.sds_parsed && (
              <button
                type="button"
                onClick={() => setDraft(d => ({ ...d, sds_path: undefined, sds_filename: undefined, sds_public_url: undefined, sds_parsed: undefined }))}
                disabled={saving || parsing}
                style={linkBtnStyle}
              >
                Remove SDS
              </button>
            )}
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Optional — or fill the fields manually below.
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input
              value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder="Product / trade name"
              maxLength={80}
              disabled={saving}
              style={inputStyle}
            />
            <input
              value={draft.manufacturer}
              onChange={e => setDraft(d => ({ ...d, manufacturer: e.target.value }))}
              placeholder="Manufacturer (optional)"
              maxLength={120}
              disabled={saving}
              style={inputStyle}
            />
          </div>

          <input
            value={draft.active_ingredient}
            onChange={e => setDraft(d => ({ ...d, active_ingredient: e.target.value }))}
            placeholder="Active ingredient (optional)"
            maxLength={120}
            disabled={saving}
            style={{ ...inputStyle, marginTop: 8 }}
          />

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Hazard classes</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {HAZARD_CLASSES.map(hc => {
                const on = draft.hazard_classes.has(hc)
                const t = HAZARD_THEME[hc]
                return (
                  <button
                    key={hc}
                    type="button"
                    onClick={() => toggleHazardInDraft(hc)}
                    disabled={saving || parsing}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                      background: on ? t.bg : 'transparent',
                      border: `1px solid ${on ? t.border : 'var(--border)'}`,
                      color: on ? t.color : 'var(--text-muted)',
                      cursor: saving ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {on && <span>✓</span>}
                    {CHEMICAL_HAZARD_CLASS_LABELS[hc]}
                  </button>
                )
              })}
            </div>
          </div>

          <textarea
            value={draft.notes}
            onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
            placeholder="Internal notes (optional)"
            maxLength={240}
            disabled={saving}
            rows={2}
            style={{ ...inputStyle, marginTop: 10, resize: 'vertical', fontFamily: 'inherit' }}
          />

          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={addItem}
              disabled={saving || parsing || !draft.name.trim()}
              style={{
                fontSize: 13, fontWeight: 600,
                padding: '8px 16px', borderRadius: 8,
                background: 'var(--accent)', color: '#fff', border: 'none',
                cursor: saving || parsing || !draft.name.trim() ? 'not-allowed' : 'pointer',
                opacity: saving || parsing || !draft.name.trim() ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Add to catalogue'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────── Styles ────────────────────────────── */

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
}

const linkStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--accent)',
  textDecoration: 'underline',
  cursor: 'pointer',
  background: 'none',
  border: 'none',
}

const linkBtnStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  background: 'none',
  border: 'none',
  textDecoration: 'underline',
  cursor: 'pointer',
}

function hazardPillStyle(hc: ChemicalHazardClass): React.CSSProperties {
  const t = HAZARD_THEME[hc]
  return {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    padding: '2px 8px',
    borderRadius: 999,
    background: t.bg,
    border: `1px solid ${t.border}`,
    color: t.color,
  }
}

function signalPillStyle(kind: 'danger' | 'warning'): React.CSSProperties {
  const danger = kind === 'danger'
  return {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    padding: '2px 8px',
    borderRadius: 4,
    background: danger ? 'rgba(239, 68, 68, 0.2)' : 'rgba(251, 191, 36, 0.18)',
    border: `1px solid ${danger ? 'rgba(239, 68, 68, 0.5)' : 'rgba(251, 191, 36, 0.45)'}`,
    color: danger ? '#FCA5A5' : '#FCD34D',
  }
}
