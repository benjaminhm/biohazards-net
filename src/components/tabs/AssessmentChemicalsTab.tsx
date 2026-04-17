/*
 * Assessment → Chemicals. HITL selection of chemicals used on this job.
 *
 * Four sections:
 *   1. Catalogue checklist — org chemicals_catalogue (active rows). Ticking a
 *      row opens an inline "application + dilution" popover so we capture
 *      enough per-job detail to populate SWMS / SOP downstream.
 *   2. AI suggestions — suggested_chemicals_ai. Each row offers:
 *        a) "Tick (in catalogue)" when matched to a catalogue id,
 *        b) "+ Add to catalogue & tick" — promotes then ticks in one move,
 *        c) "Ad-hoc" — records this job only.
 *   3. Ad-hoc chips — per-job only (one-off chemicals not worth catalogue space).
 *   4. Identify / Generate AI controls (explicit HITL trigger, never auto).
 *
 * Persists to assessment_data.used_chemical_catalogue_uses (JobChemicalUse[])
 * plus adhoc_chemical_chips and suggested_chemicals_ai.
 */
'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  AdhocChemicalItem,
  AssessmentData,
  ChemicalApplication,
  ChemicalCatalogueItem,
  ChemicalHazardClass,
  Job,
  JobChemicalUse,
  SuggestedChemicalItem,
} from '@/lib/types'
import {
  CHEMICAL_APPLICATION_LABELS,
  CHEMICAL_HAZARD_CLASS_LABELS,
} from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'

const HAZARD_CLASSES = Object.keys(CHEMICAL_HAZARD_CLASS_LABELS) as ChemicalHazardClass[]
const APPLICATIONS = Object.keys(CHEMICAL_APPLICATION_LABELS) as ChemicalApplication[]

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

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
}

function Subheading({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
      {children}
    </div>
  )
}

export default function AssessmentChemicalsTab({ job, onJobUpdate }: Props) {
  const [catalogue, setCatalogue] = useState<ChemicalCatalogueItem[]>([])
  const [catalogueLoaded, setCatalogueLoaded] = useState(false)
  const [identifyLoading, setIdentifyLoading] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [identifyError, setIdentifyError] = useState('')
  const [generateError, setGenerateError] = useState('')
  const [saving, setSaving] = useState(false)
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Inline editor for "how is this chemical used on this job" (application + dilution)
  const [editingUseForId, setEditingUseForId] = useState<string | null>(null)
  const [editApp, setEditApp] = useState<ChemicalApplication>('surface_wipe')
  const [editDilution, setEditDilution] = useState('')

  const [draftName, setDraftName] = useState('')
  const [draftApp, setDraftApp] = useState<ChemicalApplication>('surface_wipe')
  const [draftDilution, setDraftDilution] = useState('')
  const [draftHazard, setDraftHazard] = useState<Set<ChemicalHazardClass>>(new Set())

  useEffect(() => {
    let cancelled = false
    fetch('/api/company/chemicals')
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
  const uses: JobChemicalUse[] = useMemo(
    () => ad?.used_chemical_catalogue_uses ?? [],
    [ad?.used_chemical_catalogue_uses],
  )
  const useById = useMemo(() => {
    const m = new Map<string, JobChemicalUse>()
    for (const u of uses) m.set(u.catalogue_id, u)
    return m
  }, [uses])

  const adhocItems = useMemo(() => ad?.adhoc_chemical_chips ?? [], [ad?.adhoc_chemical_chips])
  const suggestions = useMemo(
    () => ad?.suggested_chemicals_ai?.items ?? [],
    [ad?.suggested_chemicals_ai?.items],
  )

  const activeCatalogue = useMemo(() => catalogue.filter(i => !i.archived), [catalogue])

  const suggestionsToShow = useMemo(() => {
    const adhocNames = new Set(adhocItems.map(i => i.name.toLowerCase()))
    return suggestions.filter(s => {
      if (s.catalogue_id && useById.has(s.catalogue_id)) return false
      if (adhocNames.has(s.name.toLowerCase())) return false
      return true
    })
  }, [suggestions, useById, adhocItems])

  const busy = identifyLoading || generateLoading || saving

  async function patchAssessment(next: AssessmentData, what: string) {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: next }),
      })
      const payload = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !payload.job) throw new Error(payload.error ?? `Could not save ${what}`)
      onJobUpdate(payload.job)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function persistUses(nextUses: JobChemicalUse[]) {
    const merged: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      used_chemical_catalogue_uses: nextUses,
    }
    void patchAssessment(merged, 'chemical use')
  }

  function toggleCatalogue(id: string, defaultApplication: ChemicalApplication = 'surface_wipe') {
    const existing = useById.get(id)
    if (existing) {
      persistUses(uses.filter(u => u.catalogue_id !== id))
      return
    }
    const next: JobChemicalUse = { catalogue_id: id, application: defaultApplication }
    persistUses([...uses, next])
  }

  function beginEditUse(id: string) {
    const existing = useById.get(id)
    setEditingUseForId(id)
    setEditApp(existing?.application ?? 'surface_wipe')
    setEditDilution(existing?.dilution ?? '')
  }

  function saveEditUse() {
    if (!editingUseForId) return
    const id = editingUseForId
    const next: JobChemicalUse = {
      catalogue_id: id,
      application: editApp,
      ...(editDilution.trim() ? { dilution: editDilution.trim().slice(0, 40) } : {}),
    }
    const hasRow = useById.has(id)
    const nextUses = hasRow
      ? uses.map(u => (u.catalogue_id === id ? next : u))
      : [...uses, next]
    setEditingUseForId(null)
    persistUses(nextUses)
  }

  async function promoteSuggestionToCatalogue(s: SuggestedChemicalItem) {
    if (promotingId) return
    setPromotingId(s.id)
    setError('')
    try {
      const res = await fetch('/api/company/chemicals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: s.name,
          hazard_classes: s.hazard_classes,
          ...(s.rationale ? { notes: s.rationale } : {}),
        }),
      })
      const data = (await res.json()) as {
        item?: ChemicalCatalogueItem
        items?: ChemicalCatalogueItem[]
        error?: string
      }
      if (!res.ok || !data.item) throw new Error(data.error || 'Could not add to catalogue')
      setCatalogue(data.items ?? [])
      const nextUses: JobChemicalUse[] = [
        ...uses,
        {
          catalogue_id: data.item.id,
          application: s.application,
          ...(s.dilution ? { dilution: s.dilution } : {}),
        },
      ]
      const merged: AssessmentData = {
        ...mergeAssessmentData(ad),
        ...(ad ?? {}),
        used_chemical_catalogue_uses: nextUses,
      }
      await patchAssessment(merged, 'promotion')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not add to catalogue')
    } finally {
      setPromotingId(null)
    }
  }

  function tickSuggestionInCatalogue(s: SuggestedChemicalItem) {
    if (!s.catalogue_id) return
    if (useById.has(s.catalogue_id)) return
    const next: JobChemicalUse = {
      catalogue_id: s.catalogue_id,
      application: s.application,
      ...(s.dilution ? { dilution: s.dilution } : {}),
    }
    persistUses([...uses, next])
  }

  function addSuggestionAsAdhoc(s: SuggestedChemicalItem) {
    const name = s.name.trim()
    if (!name) return
    if (adhocItems.some(i => i.name.toLowerCase() === name.toLowerCase())) return
    const next: AdhocChemicalItem = {
      id: `adhoc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      name,
      hazard_classes: s.hazard_classes,
      application: s.application,
      ...(s.dilution ? { dilution: s.dilution } : {}),
      ...(s.rationale ? { notes: s.rationale } : {}),
    }
    const merged: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      adhoc_chemical_chips: [...adhocItems, next],
    }
    void patchAssessment(merged, 'ad-hoc')
  }

  function addManualAdhoc() {
    const name = draftName.trim()
    if (!name) return
    if (adhocItems.some(i => i.name.toLowerCase() === name.toLowerCase())) {
      setError('That ad-hoc chemical is already in your list.')
      return
    }
    const next: AdhocChemicalItem = {
      id: `adhoc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      name,
      hazard_classes: Array.from(draftHazard),
      application: draftApp,
      ...(draftDilution.trim() ? { dilution: draftDilution.trim().slice(0, 40) } : {}),
    }
    const merged: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      adhoc_chemical_chips: [...adhocItems, next],
    }
    setDraftName('')
    setDraftDilution('')
    setDraftHazard(new Set())
    void patchAssessment(merged, 'ad-hoc')
  }

  function removeAdhoc(id: string) {
    const merged: AssessmentData = {
      ...mergeAssessmentData(ad),
      ...(ad ?? {}),
      adhoc_chemical_chips: adhocItems.filter(i => i.id !== id),
    }
    void patchAssessment(merged, 'ad-hoc removal')
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
      const res = await fetch(`/api/jobs/${job.id}/suggest-chemicals`, {
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

  const toggleDraftHazard = (hc: ChemicalHazardClass) => {
    setDraftHazard(prev => {
      const next = new Set(prev)
      if (next.has(hc)) next.delete(hc)
      else next.add(hc)
      return next
    })
  }

  const tickedCount = uses.length + adhocItems.length

  return (
    <div style={{ paddingBottom: 40 }}>
      {error && (
        <div
          style={{
            fontSize: 12, color: '#fecaca',
            border: '1px solid #7f1d1d',
            background: 'rgba(127,29,29,0.15)',
            padding: '8px 10px', borderRadius: 8, marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      {/* ── Catalogue checklist ──────────────────────────────── */}
      <section style={{ marginBottom: 28 }}>
        <div
          style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            gap: 8, marginBottom: 8, flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>
            Catalogue · tick what you&apos;re using on this job
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {tickedCount > 0 ? `${tickedCount} chemical${tickedCount === 1 ? '' : 's'} selected` : 'Nothing ticked yet'}
          </div>
        </div>
        <div className="card" style={{ padding: 16, display: 'grid', gap: 12 }}>
          {!catalogueLoaded ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading catalogue…</div>
          ) : activeCatalogue.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              No chemicals in your catalogue yet. Add products in Settings → Chemicals catalogue (upload an SDS
              to auto-fill most fields), or let AI suggestions below promote items with one click.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activeCatalogue.map(item => {
                const use = useById.get(item.id)
                const on = Boolean(use)
                const editing = editingUseForId === item.id
                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                      padding: '8px 12px', borderRadius: 10,
                      background: on ? 'rgba(34, 197, 94, 0.08)' : 'var(--surface-2)',
                      border: `1px solid ${on ? 'rgba(34, 197, 94, 0.35)' : 'var(--border)'}`,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleCatalogue(item.id)}
                      disabled={busy}
                      title={item.sds_parsed?.handling_precautions || item.notes || ''}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                        background: on ? 'rgba(34, 197, 94, 0.2)' : 'transparent',
                        border: `1px solid ${on ? 'rgba(34, 197, 94, 0.45)' : 'var(--border)'}`,
                        color: on ? '#86EFAC' : 'var(--text)',
                        cursor: busy ? 'wait' : 'pointer',
                      }}
                    >
                      <span style={{ fontWeight: 800 }} aria-hidden>{on ? '✓' : '+'}</span>
                      {item.name}
                    </button>
                    {item.hazard_classes.slice(0, 3).map(hc => (
                      <span key={hc} style={hazardPillStyle(hc)}>
                        {CHEMICAL_HAZARD_CLASS_LABELS[hc]}
                      </span>
                    ))}
                    {on && !editing && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {CHEMICAL_APPLICATION_LABELS[use!.application]}
                        {use?.dilution ? ` · ${use.dilution}` : ''}
                        <button type="button" onClick={() => beginEditUse(item.id)} disabled={busy} style={inlineLinkBtnStyle}>
                          edit
                        </button>
                      </div>
                    )}
                    {editing && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <select
                          value={editApp}
                          onChange={e => setEditApp(e.target.value as ChemicalApplication)}
                          disabled={busy}
                          style={miniSelectStyle}
                        >
                          {APPLICATIONS.map(a => (
                            <option key={a} value={a}>{CHEMICAL_APPLICATION_LABELS[a]}</option>
                          ))}
                        </select>
                        <input
                          value={editDilution}
                          onChange={e => setEditDilution(e.target.value)}
                          placeholder="Dilution (e.g. 1:10)"
                          maxLength={40}
                          disabled={busy}
                          style={{ ...miniSelectStyle, width: 140 }}
                        />
                        <button type="button" onClick={saveEditUse} disabled={busy} style={chipActionStyle('accent', busy)}>Save</button>
                        <button type="button" onClick={() => setEditingUseForId(null)} disabled={busy} style={chipActionStyle('ghost', busy)}>Cancel</button>
                      </div>
                    )}
                    {item.sds_path && (
                      <a
                        href={`/api/company/chemicals/sds?path=${encodeURIComponent(item.sds_path)}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--accent)', textDecoration: 'underline' }}
                      >
                        SDS
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── AI suggestions ───────────────────────────────────── */}
      <section style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 8 }}>
          AI suggestions
        </div>
        <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 140 }}>
          {(identifyError || generateError) && (
            <div style={{ fontSize: 12, color: '#F87171' }}>
              {identifyError && <div>{identifyError}</div>}
              {generateError && <div>{generateError}</div>}
            </div>
          )}
          {suggestionsToShow.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {suggestions.length === 0
                ? 'None yet. Press Identify to extract chemicals named in progress notes and captions, or Generate for an evidence-backed set given this job\u2019s hazards.'
                : 'All AI suggestions have been ticked or actioned.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {suggestionsToShow.map(s => (
                <div
                  key={s.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    padding: '8px 12px', borderRadius: 10,
                    background: 'var(--surface-2)', border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {s.hazard_classes.slice(0, 3).map(hc => (
                      <span key={hc} style={hazardPillStyle(hc)}>{CHEMICAL_HAZARD_CLASS_LABELS[hc]}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1, minWidth: 0 }}>
                    {CHEMICAL_APPLICATION_LABELS[s.application]}
                    {s.dilution ? ` · ${s.dilution}` : ''}
                    {s.rationale ? ` · ${s.rationale}` : ''}
                    {s.catalogue_id ? ' · matches catalogue' : ''}
                  </div>
                  {s.catalogue_id ? (
                    <button type="button" onClick={() => tickSuggestionInCatalogue(s)} disabled={busy} style={chipActionStyle('accent', busy)}>
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
                  <button type="button" onClick={() => addSuggestionAsAdhoc(s)} disabled={busy} style={chipActionStyle('ghost', busy)}>
                    Ad-hoc
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 'auto' }}>
            <button type="button" disabled={busy} onClick={() => void runAi('identify')} style={ghostBtnStyle(busy)}>
              {identifyLoading ? 'Identifying…' : 'Identify'}
            </button>
            <button type="button" disabled={busy} onClick={() => void runAi('generate')} style={accentBtnStyle(busy)}>
              {generateLoading ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
      </section>

      {/* ── Ad-hoc ───────────────────────────────────────────── */}
      <section style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 8 }}>
          Ad-hoc (this job only)
        </div>
        <div className="card" style={{ padding: 16, display: 'grid', gap: 12 }}>
          <Subheading>Currently added</Subheading>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {adhocItems.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Use this for one-off chemicals (e.g. a product borrowed for a single job). Prefer the catalogue
                for anything you&apos;ll use again — SDS gets captured once and reused.
              </div>
            ) : (
              adhocItems.map(item => (
                <div key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={adhocPillStyle}>
                    <span style={{ fontWeight: 800 }} aria-hidden>✓</span>
                    <span>{item.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {CHEMICAL_APPLICATION_LABELS[item.application]}
                      {item.dilution ? ` · ${item.dilution}` : ''}
                    </span>
                  </span>
                  <button type="button" onClick={() => removeAdhoc(item.id)} disabled={busy} style={inlineLinkBtnStyle}>
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>

          <Subheading>Add ad-hoc</Subheading>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1.2fr) minmax(0, 1fr) auto', gap: 8 }}>
            <input
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              placeholder="Chemical name"
              maxLength={80}
              disabled={busy}
              style={inputStyle}
            />
            <select
              value={draftApp}
              onChange={e => setDraftApp(e.target.value as ChemicalApplication)}
              disabled={busy}
              style={inputStyle}
            >
              {APPLICATIONS.map(a => (
                <option key={a} value={a}>{CHEMICAL_APPLICATION_LABELS[a]}</option>
              ))}
            </select>
            <input
              value={draftDilution}
              onChange={e => setDraftDilution(e.target.value)}
              placeholder="Dilution (optional)"
              maxLength={40}
              disabled={busy}
              style={inputStyle}
            />
            <button
              type="button"
              onClick={addManualAdhoc}
              disabled={busy || !draftName.trim()}
              style={{
                fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 8,
                background: 'var(--accent)', color: '#fff', border: 'none',
                cursor: busy || !draftName.trim() ? 'not-allowed' : 'pointer',
                opacity: busy || !draftName.trim() ? 0.6 : 1,
              }}
            >
              Add
            </button>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Hazard classes (optional)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {HAZARD_CLASSES.map(hc => {
                const on = draftHazard.has(hc)
                const t = HAZARD_THEME[hc]
                return (
                  <button
                    key={hc}
                    type="button"
                    onClick={() => toggleDraftHazard(hc)}
                    disabled={busy}
                    style={{
                      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                      background: on ? t.bg : 'transparent',
                      border: `1px solid ${on ? t.border : 'var(--border)'}`,
                      color: on ? t.color : 'var(--text-muted)',
                      cursor: busy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {CHEMICAL_HAZARD_CLASS_LABELS[hc]}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

/* ────────────────────────────── Styles ────────────────────────────── */

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

const miniSelectStyle: React.CSSProperties = {
  padding: '4px 6px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: 'inherit',
}

const inlineLinkBtnStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  background: 'none',
  border: 'none',
  textDecoration: 'underline',
  cursor: 'pointer',
  marginLeft: 6,
}

const adhocPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.3,
  background: 'rgba(167, 139, 250, 0.18)',
  border: '1px solid rgba(167, 139, 250, 0.45)',
  color: '#C4B5FD',
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

function ghostBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 13, fontWeight: 600,
    padding: '10px 18px', borderRadius: 9,
    background: 'var(--surface-2)', color: 'var(--text)',
    border: '1px solid var(--border)',
    opacity: disabled ? 0.75 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

function accentBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 13, fontWeight: 600,
    padding: '10px 18px', borderRadius: 9,
    background: 'var(--green)', color: '#fff',
    border: '1px solid rgba(34, 197, 94, 0.45)',
    opacity: disabled ? 0.75 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

function chipActionStyle(tone: 'accent' | 'ghost', disabled: boolean): React.CSSProperties {
  if (tone === 'accent') {
    return {
      fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 6,
      background: 'var(--accent)', color: '#fff', border: 'none',
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
    }
  }
  return {
    fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 6,
    background: 'transparent', color: 'var(--text-muted)',
    border: '1px solid var(--border)',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
  }
}
