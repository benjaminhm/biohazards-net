/*
 * Assessment → Equipment. HITL selection of equipment used on this job.
 *
 * Three stacked sections:
 *   1. Catalogue checklist — org equipment_catalogue grouped by category; tick to mark
 *      "used on this job" (persists to assessment_data.used_equipment_catalogue_ids).
 *   2. AI suggestions — suggested_equipment_ai chips. Each chip shows either:
 *        a) "Tick (in catalogue)"  — when the AI matched it to an existing catalogue row, or
 *        b) "+ Add to catalogue & tick"  — promotes to the org catalogue and ticks in one action
 *        c) "Tick as ad-hoc" — used on this job only, no catalogue add
 *   3. Ad-hoc chips — manual entries for this job (e.g. a rental tool used once).
 *
 * Nothing auto-extracts: Identify / Generate are explicit buttons.
 */
'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  AdhocEquipmentItem,
  AssessmentData,
  EquipmentCatalogueItem,
  EquipmentCategory,
  Job,
  SuggestedEquipmentItem,
} from '@/lib/types'
import { EQUIPMENT_CATEGORY_LABELS } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'

const CATEGORIES = Object.keys(EQUIPMENT_CATEGORY_LABELS) as EquipmentCategory[]

const CATEGORY_THEME: Record<EquipmentCategory, { bg: string; border: string; color: string }> = {
  ppe:         { bg: 'rgba(248, 113, 113, 0.18)', border: 'rgba(248, 113, 113, 0.45)', color: '#FCA5A5' },
  containment: { bg: 'rgba(167, 139, 250, 0.18)', border: 'rgba(167, 139, 250, 0.45)', color: '#C4B5FD' },
  cleaning:    { bg: 'rgba(96, 165, 250, 0.18)',  border: 'rgba(96, 165, 250, 0.45)',  color: '#93C5FD' },
  air:         { bg: 'rgba(52, 211, 153, 0.16)',  border: 'rgba(52, 211, 153, 0.4)',   color: '#6EE7B7' },
  tools:       { bg: 'rgba(251, 191, 36, 0.16)',  border: 'rgba(251, 191, 36, 0.4)',   color: '#FCD34D' },
  instruments: { bg: 'rgba(244, 114, 182, 0.16)', border: 'rgba(244, 114, 182, 0.4)',  color: '#F9A8D4' },
  waste:       { bg: 'rgba(148, 163, 184, 0.18)', border: 'rgba(148, 163, 184, 0.4)',  color: '#CBD5E1' },
  other:       { bg: 'rgba(100, 116, 139, 0.2)',  border: 'rgba(100, 116, 139, 0.45)', color: '#94A3B8' },
}

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
}

function Subheading({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  )
}

export default function AssessmentEquipmentTab({ job, onJobUpdate }: Props) {
  const [catalogue, setCatalogue] = useState<EquipmentCatalogueItem[]>([])
  const [catalogueLoaded, setCatalogueLoaded] = useState(false)
  const [identifyLoading, setIdentifyLoading] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [identifyError, setIdentifyError] = useState('')
  const [generateError, setGenerateError] = useState('')
  const [saving, setSaving] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftCategory, setDraftCategory] = useState<EquipmentCategory>('other')
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/company/equipment')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        setCatalogue(Array.isArray(d.items) ? d.items : [])
        setCatalogueLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setCatalogueLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const ad = job.assessment_data
  const usedIds = useMemo(
    () => new Set(ad?.used_equipment_catalogue_ids ?? []),
    [ad?.used_equipment_catalogue_ids],
  )
  const adhocItems = useMemo(() => ad?.adhoc_equipment_chips ?? [], [ad?.adhoc_equipment_chips])
  const suggestions = useMemo(
    () => ad?.suggested_equipment_ai?.items ?? [],
    [ad?.suggested_equipment_ai?.items],
  )

  /** Hide suggestions already represented as a ticked catalogue item or an ad-hoc chip. */
  const suggestionsToShow = useMemo(() => {
    const adhocNames = new Set(adhocItems.map(i => i.name.toLowerCase()))
    return suggestions.filter(s => {
      if (s.catalogue_id && usedIds.has(s.catalogue_id)) return false
      if (adhocNames.has(s.name.toLowerCase())) return false
      return true
    })
  }, [suggestions, usedIds, adhocItems])

  const activeCatalogue = useMemo(() => catalogue.filter(i => !i.archived), [catalogue])
  const catalogueByCategory = useMemo(() => {
    const m = new Map<EquipmentCategory, EquipmentCatalogueItem[]>()
    for (const c of CATEGORIES) m.set(c, [])
    for (const i of activeCatalogue) {
      const arr = m.get(i.category) ?? []
      arr.push(i)
      m.set(i.category, arr)
    }
    for (const [k, arr] of m) {
      m.set(
        k,
        arr.sort((a, b) => a.name.localeCompare(b.name)),
      )
    }
    return m
  }, [activeCatalogue])

  const busy = identifyLoading || generateLoading || saving

  async function patchAssessment(next: AssessmentData, optimisticNote = '') {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: next }),
      })
      const payload = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !payload.job) throw new Error(payload.error ?? `Could not save ${optimisticNote || 'equipment selection'}`)
      onJobUpdate(payload.job)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function toggleCatalogue(id: string) {
    const next = new Set(usedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    const mergedAssessment: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      used_equipment_catalogue_ids: Array.from(next),
    }
    void patchAssessment(mergedAssessment)
  }

  async function promoteSuggestionToCatalogue(s: SuggestedEquipmentItem) {
    if (promotingId) return
    setPromotingId(s.id)
    setError('')
    try {
      const res = await fetch('/api/company/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: s.name,
          category: s.category,
          ...(s.rationale ? { notes: s.rationale } : {}),
        }),
      })
      const data = (await res.json()) as {
        item?: EquipmentCatalogueItem
        items?: EquipmentCatalogueItem[]
        error?: string
      }
      if (!res.ok || !data.item) throw new Error(data.error || 'Could not add to catalogue')
      setCatalogue(data.items ?? [])
      const nextUsed = Array.from(new Set([...usedIds, data.item.id]))
      const mergedAssessment: AssessmentData = {
        ...mergeAssessmentData(ad),
        ...(ad ?? {}),
        used_equipment_catalogue_ids: nextUsed,
      }
      await patchAssessment(mergedAssessment, 'promotion')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not add to catalogue')
    } finally {
      setPromotingId(null)
    }
  }

  function addSuggestionAsAdhoc(s: SuggestedEquipmentItem) {
    const name = s.name.trim()
    if (!name) return
    if (adhocItems.some(i => i.name.toLowerCase() === name.toLowerCase())) return
    const next: AdhocEquipmentItem = {
      id: `adhoc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      name,
      category: s.category,
      ...(s.rationale ? { notes: s.rationale } : {}),
    }
    const mergedAssessment: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      adhoc_equipment_chips: [...adhocItems, next],
    }
    void patchAssessment(mergedAssessment, 'ad-hoc')
  }

  function tickSuggestionInCatalogue(s: SuggestedEquipmentItem) {
    if (!s.catalogue_id) return
    const next = Array.from(new Set([...usedIds, s.catalogue_id]))
    const mergedAssessment: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      used_equipment_catalogue_ids: next,
    }
    void patchAssessment(mergedAssessment, 'tick')
  }

  function addManualAdhoc() {
    const name = draftName.trim()
    if (!name) return
    if (adhocItems.some(i => i.name.toLowerCase() === name.toLowerCase())) {
      setError('That ad-hoc item is already in your list.')
      return
    }
    const next: AdhocEquipmentItem = {
      id: `adhoc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      name,
      category: draftCategory,
    }
    const mergedAssessment: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      adhoc_equipment_chips: [...adhocItems, next],
    }
    setDraftName('')
    void patchAssessment(mergedAssessment, 'ad-hoc')
  }

  function removeAdhoc(id: string) {
    const mergedAssessment: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      adhoc_equipment_chips: adhocItems.filter(i => i.id !== id),
    }
    void patchAssessment(mergedAssessment, 'ad-hoc removal')
  }

  async function runAi(mode: 'identify' | 'generate') {
    if (mode === 'identify') {
      setIdentifyLoading(true)
      setIdentifyError('')
    } else {
      setGenerateLoading(true)
      setGenerateError('')
    }
    try {
      const res = await fetch(`/api/jobs/${job.id}/suggest-equipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const payload = await res.json()
      if (!res.ok || payload.error) throw new Error(payload.error ?? 'AI request failed')
      if (payload.job) onJobUpdate(payload.job)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'AI request failed'
      if (mode === 'identify') setIdentifyError(msg)
      else setGenerateError(msg)
    } finally {
      if (mode === 'identify') setIdentifyLoading(false)
      else setGenerateLoading(false)
    }
  }

  const tickedCount = usedIds.size + adhocItems.length

  return (
    <div style={{ paddingBottom: 40 }}>
      {error && (
        <div
          style={{
            fontSize: 12,
            color: '#fecaca',
            border: '1px solid #7f1d1d',
            background: 'rgba(127,29,29,0.15)',
            padding: '8px 10px',
            borderRadius: 8,
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      {/* ── Catalogue checklist ──────────────────────────────── */}
      <section style={{ marginBottom: 28 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 8,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--accent)',
            }}
          >
            Catalogue · tick what&apos;s used on this job
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {tickedCount > 0 ? `${tickedCount} item${tickedCount === 1 ? '' : 's'} selected` : 'Nothing ticked yet'}
          </div>
        </div>
        <div
          className="card"
          style={{ padding: 16, display: 'grid', gap: 18 }}
        >
          {!catalogueLoaded ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading catalogue…</div>
          ) : activeCatalogue.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              No catalogue items yet. Add your team&apos;s gear in Settings → Equipment catalogue,
              or let AI suggestions below promote items into the catalogue in one click.
            </div>
          ) : (
            CATEGORIES.filter(c => (catalogueByCategory.get(c) ?? []).length > 0).map(c => {
              const t = CATEGORY_THEME[c]
              const rows = catalogueByCategory.get(c) ?? []
              return (
                <div key={c}>
                  <Subheading>{EQUIPMENT_CATEGORY_LABELS[c]}</Subheading>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {rows.map(item => {
                      const on = usedIds.has(item.id)
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => toggleCatalogue(item.id)}
                          disabled={busy}
                          title={item.notes || undefined}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 12px',
                            borderRadius: 999,
                            fontSize: 13,
                            fontWeight: 600,
                            lineHeight: 1.3,
                            background: on ? t.bg : 'transparent',
                            border: `1px solid ${on ? t.border : 'var(--border)'}`,
                            color: on ? t.color : 'var(--text-muted)',
                            cursor: busy ? 'wait' : 'pointer',
                            maxWidth: '100%',
                          }}
                        >
                          <span style={{ fontWeight: 800 }} aria-hidden>
                            {on ? '✓' : '+'}
                          </span>
                          <span>{item.name}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* ── AI suggestions ───────────────────────────────────── */}
      <section style={{ marginBottom: 28 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            marginBottom: 8,
          }}
        >
          AI suggestions
        </div>
        <div
          className="card"
          style={{
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            minHeight: 140,
          }}
        >
          {(identifyError || generateError) && (
            <div style={{ fontSize: 12, color: '#F87171' }}>
              {identifyError && <div>{identifyError}</div>}
              {generateError && <div>{generateError}</div>}
            </div>
          )}

          {suggestionsToShow.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {suggestions.length === 0
                ? 'None yet. Press Identify to extract equipment mentioned in progress notes and observations, or Generate for a broader suggestion set.'
                : 'All AI suggestions have been ticked or promoted.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {suggestionsToShow.map(s => {
                const t = CATEGORY_THEME[s.category]
                return (
                  <div
                    key={s.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                        background: t.bg,
                        border: `1px solid ${t.border}`,
                        color: t.color,
                      }}
                    >
                      {s.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{EQUIPMENT_CATEGORY_LABELS[s.category]}</span>
                      {s.rationale ? ` · ${s.rationale}` : ''}
                      {s.catalogue_id ? ' · matches catalogue' : ''}
                    </div>
                    {s.catalogue_id ? (
                      <button
                        type="button"
                        onClick={() => tickSuggestionInCatalogue(s)}
                        disabled={busy}
                        style={chipActionStyle('accent', busy)}
                      >
                        ✓ Tick
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void promoteSuggestionToCatalogue(s)}
                        disabled={busy || promotingId === s.id}
                        style={chipActionStyle('accent', busy || promotingId === s.id)}
                      >
                        {promotingId === s.id ? 'Adding…' : '+ Add to catalogue'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => addSuggestionAsAdhoc(s)}
                      disabled={busy}
                      style={chipActionStyle('ghost', busy)}
                    >
                      Ad-hoc
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              marginTop: 'auto',
            }}
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAi('identify')}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: '10px 18px',
                borderRadius: 9,
                background: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                opacity: busy ? 0.75 : 1,
                cursor: busy ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {identifyLoading ? 'Identifying…' : 'Identify'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAi('generate')}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: '10px 18px',
                borderRadius: 9,
                background: 'var(--green)',
                color: '#fff',
                border: '1px solid rgba(34, 197, 94, 0.45)',
                opacity: busy ? 0.75 : 1,
                cursor: busy ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {generateLoading ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
      </section>

      {/* ── Ad-hoc equipment ─────────────────────────────────── */}
      <section style={{ marginBottom: 28 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            marginBottom: 8,
          }}
        >
          Ad-hoc (this job only)
        </div>
        <div
          className="card"
          style={{ padding: 16, display: 'grid', gap: 12 }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {adhocItems.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Use this for one-off items (e.g. a rental tool you won&apos;t keep). Prefer the catalogue for
                anything your team will use again.
              </div>
            ) : (
              adhocItems.map(item => {
                const t = CATEGORY_THEME[item.category]
                return (
                  <div key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span
                      title={item.notes || undefined}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 12px',
                        borderRadius: 999,
                        fontSize: 13,
                        fontWeight: 600,
                        lineHeight: 1.3,
                        background: t.bg,
                        border: `1px solid ${t.border}`,
                        color: t.color,
                      }}
                    >
                      <span style={{ fontWeight: 800 }} aria-hidden>✓</span>
                      <span>{item.name}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAdhoc(item.id)}
                      disabled={busy}
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        background: 'none',
                        border: 'none',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )
              })
            )}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) auto',
              gap: 8,
            }}
          >
            <input
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              placeholder="Ad-hoc equipment name"
              maxLength={80}
              disabled={busy}
              style={inputStyle}
            />
            <select
              value={draftCategory}
              onChange={e => setDraftCategory(e.target.value as EquipmentCategory)}
              disabled={busy}
              style={inputStyle}
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c}>
                  {EQUIPMENT_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addManualAdhoc}
              disabled={busy || !draftName.trim()}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: '8px 14px',
                borderRadius: 8,
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                cursor: busy || !draftName.trim() ? 'not-allowed' : 'pointer',
                opacity: busy || !draftName.trim() ? 0.6 : 1,
              }}
            >
              Add
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: 'inherit',
}

function chipActionStyle(tone: 'accent' | 'ghost', disabled: boolean): React.CSSProperties {
  if (tone === 'accent') {
    return {
      fontSize: 12,
      fontWeight: 600,
      padding: '6px 12px',
      borderRadius: 6,
      background: 'var(--accent)',
      color: '#fff',
      border: 'none',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
    }
  }
  return {
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 12px',
    borderRadius: 6,
    background: 'transparent',
    color: 'var(--text-muted)',
    border: '1px solid var(--border)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  }
}
