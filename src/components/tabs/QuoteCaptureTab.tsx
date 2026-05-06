/*
 * Quote capture — collaborative outcome-based pricing editor.
 * AI suggests from structured data + staff instruction; HITL edits and saves.
 * Persists to assessment_data.outcome_quote_capture via PATCH /api/jobs/[id].
 */
'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type {
  Area,
  AreaPricingRow,
  Job,
  Document,
  OutcomeKind,
  OutcomeQuoteCapture,
  OutcomeQuoteRow,
  QuoteAuthorisation,
  QuoteGstMode,
  QuotePricingLayout,
  SectionTerms,
  SurfaceKind,
  SurfacePricingLine,
  VolumePricingBlock,
  VolumePricingRow,
} from '@/lib/types'
import {
  SURFACE_KINDS,
  SURFACE_LABELS,
  sumIncludedSurfaceTotals,
  upgradeLegacyAreaRow,
} from '@/lib/areaSurfaces'
import {
  OUTCOME_KIND_LABELS,
  OUTCOME_KIND_ORDER,
  derivePricingLayoutFromCapture,
  emptyVolumeBlock,
  normalizeSectionTerms,
  recomputeVolumePricingTotal,
  syncVolumePricing,
  volumePricingSubtotal,
} from '@/lib/quoteSections'

interface Props {
  job: Job
  documents: Document[]
  onJobUpdate: (job: Job) => void
  onGoToScope?: () => void
}

function toMoney(n: number): number {
  return Math.round(n * 100) / 100
}

function isQuoteGstMode(value: unknown): value is QuoteGstMode {
  return value === 'no_gst' || value === 'inclusive' || value === 'exclusive'
}

function gstModeFromRun(run: { gst_mode?: unknown; add_gst_to_total?: boolean } | null | undefined): QuoteGstMode {
  if (isQuoteGstMode(run?.gst_mode)) return run.gst_mode
  return run?.add_gst_to_total === true ? 'exclusive' : 'no_gst'
}

function areaPricingSum(areas: AreaPricingRow[]): number {
  return toMoney(areas.reduce((s, r) => s + Math.max(0, Number(r.total || 0)), 0))
}

/** Compute totals across all enabled sections. Sections that the layout
 *  marks disabled don't contribute even if their data is non-empty — so
 *  toggling a section off is non-destructive but immediately accurate. */
function computeTotals(
  rows: OutcomeQuoteRow[],
  areaPricing: AreaPricingRow[],
  volumePricing: VolumePricingBlock | null,
  layout: QuotePricingLayout,
  gstMode: QuoteGstMode,
) {
  const outcomeSum = layout.outcomes_enabled
    ? rows.reduce((s, r) => s + Math.max(0, Number(r.price || 0)), 0)
    : 0
  const surfaceSum = layout.per_sqm_enabled ? areaPricingSum(areaPricing) : 0
  const volSum = layout.per_m3_enabled ? volumePricingSubtotal(volumePricing ?? undefined) : 0
  const lineSum = toMoney(outcomeSum + surfaceSum + volSum)
  if (gstMode === 'exclusive') {
    const gst = toMoney(lineSum * 0.1)
    return { subtotal: lineSum, gst, total: toMoney(lineSum + gst) }
  }
  if (gstMode === 'inclusive') {
    const gst = toMoney(lineSum / 11)
    return { subtotal: toMoney(lineSum - gst), gst, total: lineSum }
  }
  return { subtotal: lineSum, gst: 0, total: lineSum }
}

/** Build a fresh per-room pricing snapshot from the live assessment areas,
 *  preserving the surface include-flags and unit prices the user has already
 *  entered. Surface m² values always re-derive from the current dimensions
 *  so the Assessment stays the source of truth. */
function syncAreaPricing(
  areas: Area[] | undefined,
  saved: AreaPricingRow[] | undefined,
): AreaPricingRow[] {
  const savedByName = new Map<string, AreaPricingRow>(
    (saved ?? []).map(r => [r.area_name.trim().toLowerCase(), r]),
  )
  return (areas ?? [])
    .map(a => {
      const name = (a.name || '').trim()
      if (!name) return null
      const lengthM = Number(a.length_m ?? 0)
      const widthM = Number(a.width_m ?? 0)
      const heightM = Number(a.height_m ?? 0)
      const sqm = Number(a.sqm ?? 0)
      const prior = savedByName.get(name.toLowerCase())
      const seed: AreaPricingRow = {
        area_name: name,
        length_m: lengthM,
        width_m: widthM,
        height_m: heightM,
        sqm,
        unit_price_per_sqm: Math.max(0, Number(prior?.unit_price_per_sqm ?? 0)),
        total: 0,
        surfaces: prior?.surfaces,
      }
      // upgradeLegacyAreaRow handles both modern (refresh quantities) and
      // legacy (synthesise floor/walls/ceiling) cases.
      return upgradeLegacyAreaRow(seed)
    })
    .filter((r): r is AreaPricingRow => r !== null)
}

function blankRow(seed: number, kind: OutcomeKind = 'mobilisation'): OutcomeQuoteRow {
  return {
    id: `row_${Date.now()}_${seed}`,
    areas: [],
    outcome_title: '',
    outcome_description: '',
    acceptance_criteria: '',
    price: 0,
    status: 'edited',
    included: [],
    excluded: [],
    assumptions: [],
    verification_method: '',
    kind,
  }
}

function blankSectionTerms(): SectionTerms {
  return { included: [], excluded: [], assumptions: [] }
}

function AutoGrow({
  value,
  onChange,
  placeholder,
  rows = 2,
  style,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  style?: CSSProperties
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      onInput={e => {
        const el = e.currentTarget
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight}px`
      }}
      placeholder={placeholder}
      rows={rows}
      style={{ resize: 'none', overflow: 'hidden', minHeight: `${rows * 1.6}em`, ...style }}
    />
  )
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  suggested: { bg: 'rgba(59,130,246,0.15)', fg: '#60A5FA' },
  edited:    { bg: 'rgba(250,204,21,0.15)', fg: '#FACC15' },
  approved:  { bg: 'rgba(34,197,94,0.15)',  fg: '#22C55E' },
  rejected:  { bg: 'rgba(248,113,113,0.15)', fg: '#F87171' },
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.edited
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      padding: '2px 7px',
      borderRadius: 4,
      background: c.bg,
      color: c.fg,
    }}>
      {status}
    </span>
  )
}

const SECTION: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--accent)',
  marginBottom: 10,
}

export default function QuoteCaptureTab({ job, onJobUpdate }: Props) {
  const ad = job.assessment_data
  const existing = ad?.outcome_quote_capture
  const fastQuote = ad?.fast_quote?.enabled ? ad.fast_quote : null

  const [instruction, setInstruction] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState('')

  const DEFAULT_LIABILITY = 'Liability is limited to the value of services quoted. The service provider accepts no responsibility for pre-existing damage, concealed conditions, or third-party property unless expressly agreed in writing.'
  const DEFAULT_ACCEPTANCE = 'By signing below, the client authorises the above works to commence under the terms and conditions stated in this document.'

  const [rows, setRows] = useState<OutcomeQuoteRow[]>(existing?.rows ?? [])
  const [areaPricing, setAreaPricing] = useState<AreaPricingRow[]>(() =>
    syncAreaPricing(ad?.areas, existing?.area_pricing),
  )
  const [volumePricing, setVolumePricing] = useState<VolumePricingBlock>(() =>
    syncVolumePricing(ad?.areas, existing?.volume_pricing),
  )
  const [areaPricingTerms, setAreaPricingTerms] = useState<SectionTerms>(
    existing?.area_pricing_terms ?? blankSectionTerms(),
  )
  const [volumePricingTerms, setVolumePricingTerms] = useState<SectionTerms>(
    existing?.volume_pricing_terms ?? blankSectionTerms(),
  )
  const [pricingLayout, setPricingLayout] = useState<QuotePricingLayout>(() =>
    derivePricingLayoutFromCapture(existing),
  )
  const [paymentTerms, setPaymentTerms] = useState(ad?.payment_terms ?? '')
  const [validity, setValidity] = useState(existing?.validity ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [auth, setAuth] = useState<QuoteAuthorisation>(() => {
    const a = existing?.authorisation
    return {
      access_details: a?.access_details ?? '',
      special_conditions: a?.special_conditions ?? '',
      liability_statement: a?.liability_statement ?? DEFAULT_LIABILITY,
      acceptance_statement: a?.acceptance_statement ?? DEFAULT_ACCEPTANCE,
    }
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  /** Synced with quote_line_item_runs.gst_mode — drives tab totals and composed/print quote. */
  const [gstMode, setGstMode] = useState<QuoteGstMode>(existing?.gst_mode ?? 'no_gst')
  const [gstRunLoading, setGstRunLoading] = useState(true)
  const [gstToggleSaving, setGstToggleSaving] = useState(false)
  const [gstError, setGstError] = useState('')

  useEffect(() => {
    let cancelled = false
    setGstRunLoading(true)
    setGstError('')
    fetch(`/api/jobs/${job.id}/quote-line-items`)
      .then(r => r.json())
      .then((d: { run?: { gst_mode?: QuoteGstMode; add_gst_to_total?: boolean } | null }) => {
        if (cancelled) return
        setGstMode(d.run ? gstModeFromRun(d.run) : existing?.gst_mode ?? 'no_gst')
      })
      .catch(() => {
        if (!cancelled) setGstMode(existing?.gst_mode ?? 'no_gst')
      })
      .finally(() => {
        if (!cancelled) setGstRunLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [existing?.gst_mode, job.id])

  useEffect(() => {
    const cap = job.assessment_data?.outcome_quote_capture
    setRows(cap?.rows ?? [])
    setAreaPricing(syncAreaPricing(job.assessment_data?.areas, cap?.area_pricing))
    setVolumePricing(syncVolumePricing(job.assessment_data?.areas, cap?.volume_pricing))
    setAreaPricingTerms(cap?.area_pricing_terms ?? blankSectionTerms())
    setVolumePricingTerms(cap?.volume_pricing_terms ?? blankSectionTerms())
    setPricingLayout(derivePricingLayoutFromCapture(cap))
    setGstMode(cap?.gst_mode ?? 'no_gst')
    setPaymentTerms(job.assessment_data?.payment_terms ?? '')
    setValidity(cap?.validity ?? '')
    setNotes(cap?.notes ?? '')
    const a = cap?.authorisation
    setAuth({
      access_details: a?.access_details ?? '',
      special_conditions: a?.special_conditions ?? '',
      liability_statement: a?.liability_statement ?? DEFAULT_LIABILITY,
      acceptance_statement: a?.acceptance_statement ?? DEFAULT_ACCEPTANCE,
    })
    setSaved(false)
    setSaveError('')
  }, [job.assessment_data?.outcome_quote_capture, job.assessment_data?.areas, job.assessment_data?.payment_terms, job.id, job.updated_at])

  const totals = useMemo(
    () => computeTotals(rows, areaPricing, volumePricing, pricingLayout, gstMode),
    [rows, areaPricing, volumePricing, pricingLayout, gstMode],
  )
  const areaPricingSubtotal = useMemo(() => areaPricingSum(areaPricing), [areaPricing])
  const volumeSubtotal = useMemo(() => volumePricingSubtotal(volumePricing), [volumePricing])
  const outcomesSubtotal = useMemo(
    () => toMoney(rows.reduce((s, r) => s + Math.max(0, Number(r.price || 0)), 0)),
    [rows],
  )

  async function persistGstMode(next: QuoteGstMode) {
    setGstToggleSaving(true)
    setGstError('')
    try {
      const res = await fetch(`/api/jobs/${job.id}/quote-line-items/run`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gst_mode: next }),
      })
      const data = (await res.json()) as { run?: { gst_mode?: QuoteGstMode; add_gst_to_total?: boolean }; error?: string }
      if (!res.ok) {
        setGstError(data.error ?? `Could not update GST (${res.status})`)
        return
      }
      setGstMode(gstModeFromRun(data.run))
      setSaved(false)
    } catch (e) {
      setGstError(e instanceof Error ? e.message : 'Could not update GST')
    } finally {
      setGstToggleSaving(false)
    }
  }

  function patchRow(id: string, patch: Partial<OutcomeQuoteRow>) {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch, status: 'edited' } : r)))
    setSaved(false)
    setSaveError('')
  }

  function removeRow(id: string) {
    setRows(prev => prev.filter(r => r.id !== id))
    setSaved(false)
    setSaveError('')
  }

  function patchAuth(patch: Partial<QuoteAuthorisation>) {
    setAuth(prev => ({ ...prev, ...patch }))
    setSaved(false)
    setSaveError('')
  }

  function togglePricingSection(key: keyof QuotePricingLayout) {
    setPricingLayout(prev => ({ ...prev, [key]: !prev[key] }))
    setSaved(false)
    setSaveError('')
  }

  function patchVolumeRow(idx: number, patch: Partial<VolumePricingRow>) {
    setVolumePricing(prev => {
      const nextRows = prev.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r))
      return recomputeVolumePricingTotal({ ...prev, rows: nextRows })
    })
    setSaved(false)
    setSaveError('')
  }

  function removeVolumeRow(idx: number) {
    setVolumePricing(prev => {
      const nextRows = prev.rows.filter((_, i) => i !== idx)
      return recomputeVolumePricingTotal({ ...prev, rows: nextRows })
    })
    setSaved(false)
    setSaveError('')
  }

  function addFreeFormVolumeRow() {
    setVolumePricing(prev => {
      const nextRows: VolumePricingRow[] = [
        ...prev.rows,
        { description: '', area_name: '', estimated_volume_m3: 0, notes: '' },
      ]
      return { ...prev, rows: nextRows }
    })
    setSaved(false)
    setSaveError('')
  }

  function setVolumeUnitPrice(value: number) {
    setVolumePricing(prev => recomputeVolumePricingTotal({
      ...prev,
      unit_price_per_m3: Number.isFinite(value) && value >= 0 ? value : 0,
    }))
    setSaved(false)
    setSaveError('')
  }

  function setVolumeIsEstimate(checked: boolean) {
    setVolumePricing(prev => ({ ...prev, is_estimate: checked }))
    setSaved(false)
    setSaveError('')
  }

  function patchSectionTerms(
    setter: (next: (prev: SectionTerms) => SectionTerms) => void,
    field: keyof SectionTerms,
    value: string,
  ) {
    const lines = value.split('\n').map(s => s.trim())
    setter(prev => ({ ...prev, [field]: lines }))
    setSaved(false)
    setSaveError('')
  }

  /** Update one surface row inside one area, then recompute the parent total. */
  function patchSurface(areaName: string, kind: SurfaceKind, patch: Partial<SurfacePricingLine>) {
    setAreaPricing(prev =>
      prev.map(r => {
        if (r.area_name !== areaName) return r
        const surfaces = (r.surfaces ?? []).map(s => {
          if (s.kind !== kind) return s
          const next: SurfacePricingLine = { ...s, ...patch }
          const safeRate = Math.max(0, Number(next.unit_price_per_sqm) || 0)
          next.unit_price_per_sqm = safeRate
          next.total = next.included ? toMoney(Number(next.area_m2 || 0) * safeRate) : 0
          return next
        })
        return { ...r, surfaces, total: sumIncludedSurfaceTotals(surfaces) }
      }),
    )
    setSaved(false)
    setSaveError('')
  }

  async function suggest() {
    setSuggesting(true)
    setSuggestError('')
    try {
      const res = await fetch(`/api/jobs/${job.id}/quote-outcomes/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      })
      const data = (await res.json()) as { rows?: OutcomeQuoteRow[]; error?: string }
      if (!res.ok || !data.rows?.length) {
        setSuggestError(data.error ?? 'No outcomes returned')
        return
      }
      setRows(data.rows)
      setSaved(false)
      setSaveError('')
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : 'Suggest failed')
    } finally {
      setSuggesting(false)
    }
  }

  async function save() {
    setSaving(true)
    setSaved(false)
    setSaveError('')
    try {
      const merged = { ...(ad ?? {}) } as Record<string, unknown>
      merged.payment_terms = paymentTerms
      const cleanAreaTerms = normalizeSectionTerms(areaPricingTerms)
      const cleanVolumeTerms = normalizeSectionTerms(volumePricingTerms)
      const persistedVolume = pricingLayout.per_m3_enabled || (volumePricing.rows.length > 0)
        ? recomputeVolumePricingTotal(volumePricing)
        : undefined
      merged.outcome_quote_capture = {
        mode: 'outcomes',
        rows,
        area_pricing: areaPricing,
        ...(cleanAreaTerms ? { area_pricing_terms: cleanAreaTerms } : {}),
        ...(persistedVolume ? { volume_pricing: persistedVolume } : {}),
        ...(cleanVolumeTerms ? { volume_pricing_terms: cleanVolumeTerms } : {}),
        pricing_layout: pricingLayout,
        gst_mode: gstMode,
        totals: computeTotals(rows, areaPricing, persistedVolume ?? null, pricingLayout, gstMode),
        target_pricing: {},
        validity,
        notes,
        authorisation: auth,
        last_reviewed_at: new Date().toISOString(),
      } satisfies OutcomeQuoteCapture
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: merged }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !data.job) {
        setSaveError(data.error ?? `Save failed (${res.status})`)
        return
      }
      onJobUpdate(data.job)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 720, paddingBottom: 40 }}>
      {fastQuote && (
        <div
          style={{
            border: '1px solid rgba(255,107,53,0.35)',
            background: 'rgba(255,107,53,0.06)',
            borderRadius: 12,
            padding: 14,
            marginBottom: 18,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)', marginBottom: 6 }}>
            Fast Quote mode
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 8 }}>
            Quote AI will treat this as a limited-information brief and draft with stronger assumptions, exclusions, and variation caveats.
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {(fastQuote.transcript ?? '').trim() || 'No fast quote brief has been entered yet.'}
          </div>
        </div>
      )}

      {/* ── Pricing approach toggles ───────────────────────────────────────
        * Independent on/off for each pricing axis. Real jobs combine all
        * three (callout fee + contents removal + surface decon) so this is
        * three checkboxes, not a radio. Toggling off only hides a section
        * and excludes it from totals — its data is preserved. */}
      <div style={{ marginBottom: 18 }}>
        <div style={SECTION}>Pricing approach</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6, marginBottom: 8, lineHeight: 1.5 }}>
          Toggle each section on or off — quotes can mix all three. Hidden sections preserve their data.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          {([
            { key: 'outcomes_enabled', label: '1. Mobilisation & fees', sub: 'Callout, PM, surcharges, fixed scopes' },
            { key: 'per_m3_enabled', label: '2. Contents removal', sub: 'Per cubic metre' },
            { key: 'per_sqm_enabled', label: '3. Remediation & cleaning', sub: 'Per square metre, surfaces' },
          ] as { key: keyof QuotePricingLayout; label: string; sub: string }[]).map(opt => {
            const active = pricingLayout[opt.key]
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => togglePricingSection(opt.key)}
                style={{
                  textAlign: 'left',
                  borderRadius: 9,
                  border: `1px solid ${active ? 'rgba(255,107,53,0.65)' : 'var(--border)'}`,
                  background: active ? 'rgba(255,107,53,0.12)' : 'var(--surface-2)',
                  color: 'var(--text)',
                  padding: '9px 10px',
                  cursor: 'pointer',
                }}
                aria-pressed={active}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-block',
                      width: 12, height: 12, borderRadius: 3,
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      background: active ? 'var(--accent)' : 'transparent',
                    }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 800 }}>{opt.label}</span>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>{opt.sub}</div>
              </button>
            )
          })}
        </div>
      </div>

      {pricingLayout.outcomes_enabled && (
      <>
      {/* ── Section 1 — Mobilisation, Fees & Fixed-Rate Items ── */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={SECTION}>1. Mobilisation, Fees &amp; Fixed-Rate Items</div>
          {rows.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Subtotal: <strong style={{ color: 'var(--text)' }}>${outcomesSubtotal.toFixed(2)}</strong>
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6, marginBottom: 12, lineHeight: 1.5 }}>
          Call-out, dispatch, project management, surcharges, certificates, and fixed-fee scopes.
        </div>
      </div>

      {/* ── AI instruction ── */}
      <div style={{ ...SECTION, fontSize: 11 }}>AI Instruct</div>

      <div className="field" style={{ marginBottom: 6 }}>
        <AutoGrow
          value={instruction}
          onChange={setInstruction}
          placeholder="Tell the AI how to structure Section 1 — e.g. &quot;Emergency callout + project management + after-hours surcharge. Standard biohazard mobilisation.&quot;"
          rows={2}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={suggest}
          disabled={suggesting}
          style={{ fontSize: 13, padding: '8px 18px', touchAction: 'manipulation' }}
        >
          {suggesting ? 'Thinking…' : 'Suggest fee rows'}
        </button>
        {suggesting && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Reading job data and generating…
          </span>
        )}
      </div>

      {suggestError && (
        <div style={{ fontSize: 13, color: '#F87171', marginBottom: 12, lineHeight: 1.45 }} role="alert">
          {suggestError}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
          <button
            type="button"
            onClick={() => { setRows([]); setSaved(false); setSaveError('') }}
            style={{
              fontSize: 11,
              color: '#F87171',
              background: 'none',
              border: '1px solid #F87171',
              borderRadius: 6,
              cursor: 'pointer',
              padding: '3px 10px',
            }}
          >
            Clear all
          </button>
        </div>
      )}

      {rows.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
          No items yet — use Suggest, or add a Mobilisation / Project Management / Surcharge / Fixed-fee item below.
        </div>
      )}

      <div style={{ display: 'grid', gap: 14, marginBottom: 14 }}>
        {rows.map((row, idx) => (
          <div
            key={row.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 12,
              background: 'var(--surface)',
              borderLeft: `3px solid ${row.kind === 'mobilisation' ? '#60A5FA'
                : row.kind === 'project_mgmt' ? '#A78BFA'
                : row.kind === 'surcharge' ? '#F87171'
                : row.kind === 'fixed_scope' ? '#22C55E'
                : 'var(--border)'}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>Item {idx + 1}</strong>
                <select
                  value={row.kind ?? 'other'}
                  onChange={e => patchRow(row.id, { kind: e.target.value as OutcomeKind })}
                  aria-label={`Item ${idx + 1} category`}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    padding: '3px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  {OUTCOME_KIND_ORDER.map(k => (
                    <option key={k} value={k}>{OUTCOME_KIND_LABELS[k]}</option>
                  ))}
                </select>
                <StatusBadge status={row.status} />
              </div>
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                style={{
                  fontSize: 12,
                  color: '#F87171',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px 6px',
                }}
              >
                Remove
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Title</label>
                <AutoGrow
                  value={row.outcome_title}
                  onChange={v => patchRow(row.id, { outcome_title: v })}
                  placeholder="e.g. Emergency callout & site setup"
                  rows={1}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Areas</label>
                <AutoGrow
                  value={row.areas.join(', ')}
                  onChange={v => patchRow(row.id, { areas: v.split(',').map(s => s.trim()).filter(Boolean) })}
                  placeholder="Rooms (comma separated, optional)"
                  rows={1}
                />
              </div>
            </div>

            <div className="field" style={{ marginBottom: 8 }}>
              <label>Description</label>
              <AutoGrow
                value={row.outcome_description}
                onChange={v => patchRow(row.id, { outcome_description: v })}
                placeholder="What work is included in this outcome?"
                rows={2}
              />
            </div>

            <div className="field" style={{ marginBottom: 8 }}>
              <label>Price ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={row.price || ''}
                onChange={e => patchRow(row.id, { price: Math.max(0, Number(e.target.value || 0)) })}
                placeholder="0.00"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Included</label>
                <AutoGrow
                  value={(row.included ?? []).join('\n')}
                  onChange={v => patchRow(row.id, { included: v.split('\n').filter(l => l.trim()) })}
                  placeholder="One per line"
                  rows={2}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Excluded</label>
                <AutoGrow
                  value={(row.excluded ?? []).join('\n')}
                  onChange={v => patchRow(row.id, { excluded: v.split('\n').filter(l => l.trim()) })}
                  placeholder="One per line"
                  rows={2}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Assumptions</label>
                <AutoGrow
                  value={(row.assumptions ?? []).join('\n')}
                  onChange={v => patchRow(row.id, { assumptions: v.split('\n').filter(l => l.trim()) })}
                  placeholder="One per line"
                  rows={2}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
        {OUTCOME_KIND_ORDER.filter(k => k !== 'other').map(k => (
          <button
            key={k}
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => setRows(prev => [...prev, blankRow(prev.length + 1, k)])}
          >
            + Add {OUTCOME_KIND_LABELS[k]}
          </button>
        ))}
      </div>

      </>
      )}

      {pricingLayout.per_m3_enabled && (
      <>
      {/* ── Section 2 — Contents Removal (per-m³) ───────────────────────── */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={SECTION}>2. Contents Removal</div>
          {volumeSubtotal > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Subtotal: <strong style={{ color: 'var(--text)' }}>${volumeSubtotal.toFixed(2)}</strong>
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6, marginBottom: 12, lineHeight: 1.5 }}>
          Estimated cubic-metre volume per room. Final volume measured at uplift; variance billed/credited at the same rate.
        </div>
      </div>

      {volumePricing.rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
          No rooms yet — add areas in Assessment to auto-populate, or add a free-form line below (e.g. &quot;Garage skip&quot;).
        </div>
      ) : (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: 'var(--surface)',
            marginBottom: 12,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 0.9fr 2fr 0.4fr',
              gap: 8,
              padding: '8px 12px',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface-2)',
            }}
          >
            <span>Room / Description</span>
            <span style={{ textAlign: 'right' }}>Est. m³</span>
            <span>Notes</span>
            <span aria-hidden="true" />
          </div>
          {volumePricing.rows.map((row, idx) => {
            const linkedToArea = (row.area_name ?? '').trim() !== ''
            const m3 = Number(row.estimated_volume_m3 || 0)
            return (
              <div
                key={`${row.area_name || 'free'}_${idx}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 0.9fr 2fr 0.4fr',
                  gap: 8,
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderTop: '1px solid var(--border)',
                  fontSize: 13,
                }}
              >
                <input
                  type="text"
                  value={row.description}
                  onChange={e => patchVolumeRow(idx, { description: e.target.value })}
                  placeholder={linkedToArea ? `${row.area_name} contents` : 'Free-form line'}
                  aria-label="Description"
                  style={{ width: '100%' }}
                />
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                  value={m3 > 0 ? m3 : ''}
                  onChange={e => {
                    const n = parseFloat(e.target.value)
                    patchVolumeRow(idx, { estimated_volume_m3: isNaN(n) ? 0 : Math.max(0, n) })
                  }}
                  placeholder="0.0"
                  aria-label={`${row.description || 'Row'} estimated cubic metres`}
                  style={{ width: '100%', textAlign: 'right' }}
                />
                <input
                  type="text"
                  value={row.notes ?? ''}
                  onChange={e => patchVolumeRow(idx, { notes: e.target.value })}
                  placeholder="Optional notes"
                  aria-label="Notes"
                  style={{ width: '100%' }}
                />
                {linkedToArea ? (
                  <span aria-hidden="true" />
                ) : (
                  <button
                    type="button"
                    onClick={() => removeVolumeRow(idx)}
                    aria-label="Remove free-form row"
                    style={{
                      fontSize: 12,
                      color: '#F87171',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '2px 4px',
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: 12, padding: '6px 12px' }}
          onClick={addFreeFormVolumeRow}
        >
          + Add free-form line
        </button>
        <div className="field" style={{ marginBottom: 0, flex: '0 0 180px' }}>
          <label>$/m³ rate</label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={volumePricing.unit_price_per_m3 > 0 ? volumePricing.unit_price_per_m3 : ''}
            onChange={e => {
              const n = parseFloat(e.target.value)
              setVolumeUnitPrice(isNaN(n) ? 0 : Math.max(0, n))
            }}
            placeholder="0.00"
          />
        </div>
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            checked={volumePricing.is_estimate}
            onChange={e => setVolumeIsEstimate(e.target.checked)}
          />
          Estimate (final measured at uplift)
        </label>
      </div>

      {/* Section-level terms */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 22 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Inclusions (this section)</label>
          <AutoGrow
            value={(volumePricingTerms.included ?? []).join('\n')}
            onChange={v => patchSectionTerms(setVolumePricingTerms, 'included', v)}
            placeholder="One per line — e.g. skip hire, transport, tip fees"
            rows={2}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Exclusions</label>
          <AutoGrow
            value={(volumePricingTerms.excluded ?? []).join('\n')}
            onChange={v => patchSectionTerms(setVolumePricingTerms, 'excluded', v)}
            placeholder="One per line — e.g. asbestos, items > 2m³"
            rows={2}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Assumptions</label>
          <AutoGrow
            value={(volumePricingTerms.assumptions ?? []).join('\n')}
            onChange={v => patchSectionTerms(setVolumePricingTerms, 'assumptions', v)}
            placeholder="One per line — e.g. accessible without dismantling"
            rows={2}
          />
        </div>
      </div>

      </>
      )}

      {pricingLayout.per_sqm_enabled && (
      <>
      {/* ── Section 3 — Remediation, Cleaning & Sanitisation (per-m²) ───── */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={SECTION}>3. Remediation, Cleaning &amp; Sanitisation</div>
          {areaPricing.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Subtotal: <strong style={{ color: 'var(--text)' }}>${areaPricingSubtotal.toFixed(2)}</strong>
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6, marginBottom: 12, lineHeight: 1.5 }}>
          Per-m² surface pricing driven by the Assessment dimensions. Floor / Walls / Ceiling priced independently.
        </div>
      </div>

      {areaPricing.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
          Add areas with length × width on the Assessment tab to enable per-m² quoting here.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Each room is broken into Floor / Walls / Ceiling. Tick the surfaces you&apos;re
            quoting for and enter $/m². m² values come from the Assessment dimensions —
            edit dimensions there if a room isn&apos;t a clean rectangle. Excluded surfaces
            are added to the printed quote&apos;s &quot;Excluded from this quote&quot; list automatically.
          </div>

          {areaPricing.map(row => {
            const surfaces = row.surfaces ?? []
            const dims = row.length_m > 0 && row.width_m > 0
              ? `${row.length_m}×${row.width_m}${row.height_m > 0 ? `×${row.height_m}` : ''} m`
              : '— set L × W in Assessment'
            const dimsMissing = !(row.length_m > 0 && row.width_m > 0)
            const wallsNeedsHeight = !(row.height_m > 0)
            return (
              <div
                key={row.area_name}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  background: 'var(--surface)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    padding: '10px 12px',
                    background: 'var(--surface-2)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <strong style={{ fontSize: 13 }}>{row.area_name}</strong>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dims}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    {row.total > 0 ? `$${row.total.toFixed(2)}` : <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>$0.00</span>}
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr 0.7fr 1fr 1fr',
                    gap: 8,
                    padding: '6px 12px',
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span aria-hidden="true" />
                  <span>Surface</span>
                  <span style={{ textAlign: 'right' }}>m²</span>
                  <span style={{ textAlign: 'right' }}>$/m²</span>
                  <span style={{ textAlign: 'right' }}>Total</span>
                </div>

                {SURFACE_KINDS.map(kind => {
                  const surface = surfaces.find(s => s.kind === kind)
                  if (!surface) return null
                  const isWalls = kind === 'walls'
                  const wallsBlocked = isWalls && wallsNeedsHeight
                  const needsDims = dimsMissing || wallsBlocked
                  const checkboxId = `surface_${row.area_name}_${kind}`
                  return (
                    <div
                      key={kind}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto 1fr 0.7fr 1fr 1fr',
                        gap: 8,
                        alignItems: 'center',
                        padding: '8px 12px',
                        borderTop: '1px solid var(--border)',
                        fontSize: 13,
                        opacity: surface.included ? 1 : 0.6,
                      }}
                    >
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={surface.included}
                        onChange={e => patchSurface(row.area_name, kind, { included: e.target.checked })}
                        aria-label={`Include ${SURFACE_LABELS[kind]} for ${row.area_name}`}
                        style={{ cursor: 'pointer' }}
                      />
                      <label htmlFor={checkboxId} style={{ fontWeight: 600, cursor: 'pointer' }}>
                        {SURFACE_LABELS[kind]}
                        {wallsBlocked && (
                          <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: 400 }}>
                            (set height)
                          </span>
                        )}
                      </label>
                      <span style={{ textAlign: 'right', color: needsDims ? 'var(--text-muted)' : undefined }}>
                        {surface.area_m2 > 0
                          ? surface.area_m2.toLocaleString('en-AU', { maximumFractionDigits: 2 })
                          : '—'}
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="1"
                        value={surface.unit_price_per_sqm > 0 ? surface.unit_price_per_sqm : ''}
                        onChange={e => {
                          const n = parseFloat(e.target.value)
                          patchSurface(row.area_name, kind, {
                            unit_price_per_sqm: isNaN(n) ? 0 : Math.max(0, n),
                          })
                        }}
                        placeholder="0.00"
                        aria-label={`${SURFACE_LABELS[kind]} dollars per square metre for ${row.area_name}`}
                        disabled={!surface.included}
                        style={{ width: '100%', textAlign: 'right' }}
                      />
                      <span style={{ textAlign: 'right', fontWeight: 600 }}>
                        {surface.included && surface.total > 0 ? `$${surface.total.toFixed(2)}` : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* Section-level terms for Section 3 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 22 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Inclusions (this section)</label>
          <AutoGrow
            value={(areaPricingTerms.included ?? []).join('\n')}
            onChange={v => patchSectionTerms(setAreaPricingTerms, 'included', v)}
            placeholder="One per line — e.g. IICRC S540 chemicals, PPE, biohazard waste disposal"
            rows={2}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Exclusions</label>
          <AutoGrow
            value={(areaPricingTerms.excluded ?? []).join('\n')}
            onChange={v => patchSectionTerms(setAreaPricingTerms, 'excluded', v)}
            placeholder="One per line — e.g. structural repair, painting"
            rows={2}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Assumptions</label>
          <AutoGrow
            value={(areaPricingTerms.assumptions ?? []).join('\n')}
            onChange={v => patchSectionTerms(setAreaPricingTerms, 'assumptions', v)}
            placeholder="One per line — e.g. single decontamination pass; deep contamination billed at the same rate"
            rows={2}
          />
        </div>
      </div>

      </>
      )}

      {/* ── Totals + GST treatment (syncs quote_line_item_runs for print/composer) ── */}
      <div
        style={{
          padding: '12px 16px',
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          marginBottom: 20,
          fontSize: 14,
        }}
      >
        <div
          style={{
            marginBottom: 12,
            paddingBottom: 12,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>GST treatment</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
              Choose whether the entered prices have no GST, already include GST, or need GST added on top.
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {([
              { value: 'no_gst', label: 'No GST', sub: 'No GST applied' },
              { value: 'inclusive', label: 'Inc GST', sub: 'Prices include GST' },
              { value: 'exclusive', label: 'Ex GST + Add', sub: 'Add 10% on top' },
            ] as { value: QuoteGstMode; label: string; sub: string }[]).map(option => {
              const active = gstMode === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={gstRunLoading || gstToggleSaving}
                  onClick={() => void persistGstMode(option.value)}
                  style={{
                    textAlign: 'left',
                    borderRadius: 9,
                    border: `1px solid ${active ? 'rgba(255,107,53,0.65)' : 'var(--border)'}`,
                    background: active ? 'rgba(255,107,53,0.12)' : 'var(--surface-2)',
                    color: 'var(--text)',
                    padding: '9px 10px',
                    cursor: gstRunLoading || gstToggleSaving ? 'not-allowed' : 'pointer',
                    opacity: gstRunLoading || gstToggleSaving ? 0.65 : 1,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 800 }}>{option.label}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>{option.sub}</div>
                </button>
              )
            })}
          </div>
        </div>
        {gstError && (
          <div style={{ fontSize: 12, color: '#F87171', marginBottom: 10 }} role="alert">
            {gstError}
          </div>
        )}
        {gstMode === 'exclusive' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--text-muted)' }}>Subtotal (ex GST)</span>
              <strong>${totals.subtotal.toFixed(2)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--text-muted)' }}>GST (10%)</span>
              <span>${totals.gst.toFixed(2)}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderTop: '1px solid var(--border)',
                paddingTop: 6,
                marginTop: 4,
              }}
            >
              <strong>Total (inc GST)</strong>
              <strong>${totals.total.toFixed(2)}</strong>
            </div>
          </>
        )}
        {gstMode === 'inclusive' && (
          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Total (inc GST)</span>
              <strong>${totals.total.toFixed(2)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Includes GST (10%)</span>
              <span>${totals.gst.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Subtotal (ex GST)</span>
              <span>${totals.subtotal.toFixed(2)}</span>
            </div>
          </div>
        )}
        {gstMode === 'no_gst' && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>Total (no GST)</strong>
            <strong>${totals.total.toFixed(2)}</strong>
          </div>
        )}
      </div>

      {/* ── Quote-level fields ── */}
      <div style={SECTION}>Terms</div>

      <div className="field">
        <label>Payment terms</label>
        <AutoGrow
          value={paymentTerms}
          onChange={v => { setPaymentTerms(v); setSaved(false); setSaveError('') }}
          placeholder="e.g. 50% deposit to confirm booking, balance on completion net 7 days"
          rows={2}
        />
      </div>

      <div className="field">
        <label>Quote validity</label>
        <AutoGrow
          value={validity}
          onChange={v => { setValidity(v); setSaved(false); setSaveError('') }}
          placeholder="e.g. Valid for 30 days from date of issue"
          rows={1}
        />
      </div>

      <div className="field">
        <label>Notes</label>
        <AutoGrow
          value={notes}
          onChange={v => { setNotes(v); setSaved(false); setSaveError('') }}
          placeholder="Job-specific conditions, caveats, or clarifications"
          rows={2}
        />
      </div>

      {/* ── Authorisation ── */}
      <div style={SECTION}>Authorisation</div>

      <div className="field">
        <label>Access details</label>
        <AutoGrow
          value={auth.access_details}
          onChange={v => patchAuth({ access_details: v })}
          placeholder="How and when can the technician access the site? e.g. key from agent, meet on site 7am"
          rows={2}
        />
      </div>

      <div className="field">
        <label>Special conditions</label>
        <AutoGrow
          value={auth.special_conditions}
          onChange={v => patchAuth({ special_conditions: v })}
          placeholder="Client-specific constraints — e.g. no work before 8am, pets on site, insurance requirements"
          rows={2}
        />
      </div>

      <div className="field">
        <label>Liability statement</label>
        <AutoGrow
          value={auth.liability_statement}
          onChange={v => patchAuth({ liability_statement: v })}
          placeholder="Liability limitation clause"
          rows={2}
        />
      </div>

      <div className="field">
        <label>Acceptance statement</label>
        <AutoGrow
          value={auth.acceptance_statement}
          onChange={v => patchAuth({ acceptance_statement: v })}
          placeholder="Client authorisation wording for signature"
          rows={2}
        />
      </div>

      {/* ── Save ── */}
      {saveError && (
        <div style={{ fontSize: 13, color: '#F87171', marginBottom: 10, lineHeight: 1.45 }} role="alert">
          {saveError}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        onClick={save}
        disabled={saving}
        style={{ width: '100%', padding: 14, fontSize: 15, touchAction: 'manipulation' }}
      >
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Quote'}
      </button>
    </div>
  )
}
