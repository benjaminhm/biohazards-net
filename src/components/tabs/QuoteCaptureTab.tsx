/*
 * Quote capture — collaborative outcome-based pricing editor.
 * AI suggests from structured data + staff instruction; HITL edits and saves.
 * Persists to assessment_data.outcome_quote_capture via PATCH /api/jobs/[id].
 */
'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
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
  QuoteSpoke,
  SectionTerms,
  SurfaceKind,
  SurfacePricingLine,
  VolumePricingBlock,
  VolumePricingRow,
} from '@/lib/types'
import { genQuoteSpokeId, getQuoteSpokesOrSeed, makeBlankSpoke } from '@/lib/quoteSpokes'
import {
  SURFACE_KINDS,
  SURFACE_LABELS,
  sumIncludedSurfaceTotals,
  upgradeLegacyAreaRow,
} from '@/lib/areaSurfaces'
import { effectiveAreaDimensions } from '@/lib/areaSubzones'
import {
  OUTCOME_KIND_LABELS,
  OUTCOME_KIND_ORDER,
  areaPricingSectionSubtotal,
  areaPricingSurfaceSum,
  derivePricingLayoutFromCapture,
  normalizeSectionTerms,
  quoteContentIsEstimate,
  recomputeVolumePricingTotal,
  syncVolumePricing,
  volumePricingSubtotal,
} from '@/lib/quoteSections'
import RichTextEditor from '@/components/RichTextEditor'

interface Props {
  job: Job
  documents: Document[]
  onJobUpdate: (job: Job) => void
  onGoToScope?: () => void
}

type QuoteKind = 'quote' | 'estimate'

/** Pricing section targeted by the AI suggest panel. */
type QuoteSuggestSection = 'outcomes' | 'volume' | 'surface'

const QUOTE_AI_SECTION_META: Record<
  QuoteSuggestSection,
  { placeholder: string; button: string; thinking: string }
> = {
  outcomes: {
    placeholder:
      'Tell the AI what proposed actions to draft — e.g. client-reported bedroom carpet contamination; nominate visible/source materials; avoid outcome promises.',
    button: 'Suggest proposed actions',
    thinking: 'Reading job data and generating…',
  },
  volume: {
    placeholder:
      'Tell the AI what contents to estimate — e.g. bedroom hoarding ~4 m³; garage skip load; exclude built-in fixtures.',
    button: 'Suggest contents lines',
    thinking: 'Estimating contents volumes…',
  },
  surface: {
    placeholder:
      'Tell the AI which surfaces to price — e.g. decon floor and walls in bathroom and kitchen; exclude ceilings in laundry.',
    button: 'Suggest surface pricing',
    thinking: 'Drafting surface pricing…',
  },
}

/**
 * Default the doc-identity toggle from saved capture state. Honours an
 * explicit `quote_kind` when present; otherwise derives from the same
 * heuristic the print path used pre-toggle (per-m³ section flagged as
 * estimate) so the toggle reflects whatever the rendered doc was already
 * showing the client.
 */
function deriveQuoteKind(cap: OutcomeQuoteCapture | undefined | null): QuoteKind {
  if (cap?.quote_kind === 'quote' || cap?.quote_kind === 'estimate') return cap.quote_kind
  return quoteContentIsEstimate({
    pricing_layout: cap?.pricing_layout,
    volume_pricing: cap?.volume_pricing,
  })
    ? 'estimate'
    : 'quote'
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

function computeTotals(
  rows: OutcomeQuoteRow[],
  areaPricing: AreaPricingRow[],
  volumePricing: VolumePricingBlock | null,
  layout: QuotePricingLayout,
  gstMode: QuoteGstMode,
  globalMobilisationFee = 0,
  areaPricingSectionTotal = 0,
) {
  const outcomeSum = layout.outcomes_enabled
    ? Math.max(0, Number(globalMobilisationFee || 0)) + rows.reduce((s, r) => s + Math.max(0, Number(r.price || 0)), 0)
    : 0
  const surfaceSum = layout.per_sqm_enabled
    ? areaPricingSectionSubtotal(areaPricing, areaPricingSectionTotal)
    : 0
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

function fmtM2(n: number): string {
  return `${Number(n || 0).toLocaleString('en-AU', { maximumFractionDigits: 2 })} m²`
}

function areaSurfaceMeasurements(area: Area) {
  // Single source of truth for area dims — handles multi-zone areas (with
  // per-room subzones) by summing across subzones. See areaSubzones.ts.
  const dims = effectiveAreaDimensions(area)
  return {
    length: dims.length ?? 0,
    width: dims.width ?? 0,
    height: dims.height ?? 0,
    floor: toMoney(dims.floor),
    ceiling: toMoney(dims.ceiling),
    walls: toMoney(dims.walls),
    total: toMoney(dims.totalSurface),
  }
}

function selectedAreasForRow(row: OutcomeQuoteRow, areas: Area[] | undefined): Area[] {
  const byName = new Map((areas ?? []).map(a => [(a.name || '').trim().toLowerCase(), a]))
  return (row.areas ?? [])
    .map(name => byName.get(name.trim().toLowerCase()))
    .filter((a): a is Area => Boolean(a))
}

function totalSurfaceM2ForAreas(areas: Area[]): number {
  return toMoney(areas.reduce((sum, area) => sum + areaSurfaceMeasurements(area).total, 0))
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
      // Effective dims handle multi-zone areas (per-room subzones) by summing
      // across subzones. For single-zone areas it matches a.length_m etc.
      const dims = effectiveAreaDimensions(a)
      const lengthM = dims.length ?? Number(a.length_m ?? 0)
      const widthM = dims.width ?? Number(a.width_m ?? 0)
      const heightM = dims.height ?? Number(a.height_m ?? 0)
      const sqm = dims.floor > 0 ? dims.floor : Number(a.sqm ?? 0)
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
      // For multi-zone areas the aggregate L × W rectangle isn't well-defined
      // (walls especially), so we pass surface overrides computed by summing
      // across subzones. buildSurfaceLines picks the override when provided.
      const overrides = dims.isMultiZone
        ? { floor: dims.floor, walls: dims.walls, ceiling: dims.ceiling }
        : undefined
      return upgradeLegacyAreaRow(seed, overrides)
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
    contents: [],
    verification_method: '',
    kind,
  }
}

function blankSectionTerms(): SectionTerms {
  return { observed_contents: [], included: [], excluded: [], assumptions: [] }
}

const OBSERVED_CONTENTS_PLACEHOLDER =
  'One per line — e.g.\nReported affected carpet\nFurniture requiring relocation\nLoose household contents'

function SectionObservedContentsField({
  terms,
  onChange,
}: {
  terms: SectionTerms
  onChange: (field: keyof SectionTerms, value: string) => void
}) {
  return (
    <div className="field" style={{ marginBottom: 14 }}>
      <label>Observed / reported contents</label>
      <AutoGrow
        value={(terms.observed_contents ?? []).join('\n')}
        onChange={v => onChange('observed_contents', v)}
        placeholder={OBSERVED_CONTENTS_PLACEHOLDER}
        rows={3}
      />
    </div>
  )
}

/** Parse comma-separated room list without eating the trailing comma/space while typing. */
function parseAreasInput(v: string): string[] {
  const parts = v.split(',')
  return parts
    .map((p, i) => (i === parts.length - 1 ? p.trimLeft() : p.trim()))
    .filter((p, i, arr) => p.length > 0 || i === arr.length - 1)
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
      onKeyDown={e => e.stopPropagation()}
      placeholder={placeholder}
      rows={rows}
      style={{ resize: 'none', overflow: 'hidden', minHeight: `${rows * 1.6}em`, ...style }}
    />
  )
}

/** AI instruction + suggest button — one panel per enabled pricing section. */
function QuoteSectionAiPanel({
  section,
  instruction,
  onInstructionChange,
  onSuggest,
  suggesting,
  error,
}: {
  section: QuoteSuggestSection
  instruction: string
  onInstructionChange: (v: string) => void
  onSuggest: () => void
  suggesting: boolean
  error: string
}) {
  const meta = QUOTE_AI_SECTION_META[section]
  return (
    <>
      <div style={{ ...SECTION, fontSize: 11 }}>AI Instructions</div>
      <div className="field" style={{ marginBottom: 6 }}>
        <AutoGrow
          value={instruction}
          onChange={onInstructionChange}
          placeholder={meta.placeholder}
          rows={2}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: error ? 8 : 20 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSuggest}
          disabled={suggesting}
          style={{ fontSize: 13, padding: '8px 18px', touchAction: 'manipulation' }}
        >
          {suggesting ? 'Thinking…' : meta.button}
        </button>
        {suggesting && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{meta.thinking}</span>
        )}
      </div>
      {error && (
        <div style={{ fontSize: 13, color: '#F87171', marginBottom: 12, lineHeight: 1.45 }} role="alert">
          {error}
        </div>
      )}
    </>
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
  const router = useRouter()
  const ad = job.assessment_data
  const fastQuote = ad?.fast_quote?.enabled ? ad.fast_quote : null

  // Hub-and-spoke: assessment_data is the shared hub; each spoke is an
  // independent named quote. Seed at least one so the editor is never empty.
  const initialSpokesRef = useRef<QuoteSpoke[] | null>(null)
  if (initialSpokesRef.current === null) {
    initialSpokesRef.current = getQuoteSpokesOrSeed(ad)
  }
  const [spokes, setSpokes] = useState<QuoteSpoke[]>(initialSpokesRef.current)
  const [activeSpokeId, setActiveSpokeId] = useState<string>(initialSpokesRef.current[0].id)
  /** The active spoke's capture — drives every field's initial value below. */
  const existing: OutcomeQuoteCapture | undefined =
    spokes.find(s => s.id === activeSpokeId) ?? spokes[0]

  const [sectionInstructions, setSectionInstructions] = useState<Record<QuoteSuggestSection, string>>({
    outcomes: '',
    volume: '',
    surface: '',
  })
  const [suggestingSection, setSuggestingSection] = useState<QuoteSuggestSection | null>(null)
  const [suggestErrorBySection, setSuggestErrorBySection] = useState<Partial<Record<QuoteSuggestSection, string>>>({})

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
  const [outcomesSectionTerms, setOutcomesSectionTerms] = useState<SectionTerms>(
    existing?.outcomes_section_terms ?? blankSectionTerms(),
  )
  const [volumePricingTerms, setVolumePricingTerms] = useState<SectionTerms>(
    existing?.volume_pricing_terms ?? blankSectionTerms(),
  )
  const [pricingLayout, setPricingLayout] = useState<QuotePricingLayout>(() =>
    derivePricingLayoutFromCapture(existing),
  )
  /** Explicit doc identity — drives the printed doc's banner + reference
   *  prefix. Defaults derived from saved capture so legacy quotes don't
   *  silently flip identity on first open. */
  const [quoteKind, setQuoteKind] = useState<QuoteKind>(() => deriveQuoteKind(existing))
  const [globalMobilisationFee, setGlobalMobilisationFee] = useState<number>(
    Math.max(0, Number(existing?.global_mobilisation_fee ?? 0)),
  )
  const [globalSurfaceRatePerM2, setGlobalSurfaceRatePerM2] = useState<number>(
    Math.max(0, Number(existing?.global_surface_rate_per_m2 ?? 0)),
  )
  const [globalContentsRatePerM3, setGlobalContentsRatePerM3] = useState<number>(
    Math.max(0, Number(existing?.global_contents_rate_per_m3 ?? 0)),
  )
  const [areaPricingSectionTotal, setAreaPricingSectionTotal] = useState<number>(
    Math.max(0, Number(existing?.area_pricing_section_total ?? 0)),
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
        // Spoke GST is the source of truth; the per-job run is only a fallback
        // for legacy single-quote jobs whose capture predates gst_mode.
        setGstMode(existing?.gst_mode ?? (d.run ? gstModeFromRun(d.run) : 'no_gst'))
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

  /** Push one capture (spoke) into every editor field. Shared by the job-sync
   *  effect and the spoke selector handlers. Payment terms stay job-level (hub). */
  function applyCapture(cap: OutcomeQuoteCapture | undefined) {
    setRows(cap?.rows ?? [])
    setAreaPricing(syncAreaPricing(job.assessment_data?.areas, cap?.area_pricing))
    setVolumePricing(syncVolumePricing(job.assessment_data?.areas, cap?.volume_pricing))
    setAreaPricingTerms(cap?.area_pricing_terms ?? blankSectionTerms())
    setOutcomesSectionTerms(cap?.outcomes_section_terms ?? blankSectionTerms())
    setVolumePricingTerms(cap?.volume_pricing_terms ?? blankSectionTerms())
    setPricingLayout(derivePricingLayoutFromCapture(cap))
    setQuoteKind(deriveQuoteKind(cap))
    setGlobalMobilisationFee(Math.max(0, Number(cap?.global_mobilisation_fee ?? 0)))
    setGlobalSurfaceRatePerM2(Math.max(0, Number(cap?.global_surface_rate_per_m2 ?? 0)))
    setGlobalContentsRatePerM3(Math.max(0, Number(cap?.global_contents_rate_per_m3 ?? 0)))
    setAreaPricingSectionTotal(Math.max(0, Number(cap?.area_pricing_section_total ?? 0)))
    setGstMode(cap?.gst_mode ?? 'no_gst')
    setValidity(cap?.validity ?? '')
    setNotes(cap?.notes ?? '')
    const a = cap?.authorisation
    setAuth({
      access_details: a?.access_details ?? '',
      special_conditions: a?.special_conditions ?? '',
      liability_statement: a?.liability_statement ?? DEFAULT_LIABILITY,
      acceptance_statement: a?.acceptance_statement ?? DEFAULT_ACCEPTANCE,
    })
  }

  // Re-sync from the server copy when the job changes (e.g. after our own save).
  // Spoke switching is handled locally in switchSpoke(); we keep the current
  // selection if it still exists, else fall back to the first spoke.
  useEffect(() => {
    const fresh = getQuoteSpokesOrSeed(job.assessment_data)
    setSpokes(fresh)
    const active = fresh.find(s => s.id === activeSpokeId) ?? fresh[0]
    setActiveSpokeId(active.id)
    applyCapture(active)
    setPaymentTerms(job.assessment_data?.payment_terms ?? '')
    setSaved(false)
    setSaveError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.assessment_data?.outcome_quotes, job.assessment_data?.outcome_quote_capture, job.assessment_data?.areas, job.assessment_data?.payment_terms, job.id, job.updated_at])

  const totals = useMemo(
    () =>
      computeTotals(
        rows,
        areaPricing,
        volumePricing,
        pricingLayout,
        gstMode,
        globalMobilisationFee,
        areaPricingSectionTotal,
      ),
    [rows, areaPricing, volumePricing, pricingLayout, gstMode, globalMobilisationFee, areaPricingSectionTotal],
  )
  const areaPricingSurfaceSubtotal = useMemo(
    () => areaPricingSurfaceSum(areaPricing),
    [areaPricing],
  )
  const areaPricingSubtotal = useMemo(
    () => areaPricingSectionSubtotal(areaPricing, areaPricingSectionTotal),
    [areaPricing, areaPricingSectionTotal],
  )
  const volumeSubtotal = useMemo(() => volumePricingSubtotal(volumePricing), [volumePricing])
  const outcomesSubtotal = useMemo(
    () => toMoney(Math.max(0, Number(globalMobilisationFee || 0)) + rows.reduce((s, r) => s + Math.max(0, Number(r.price || 0)), 0)),
    [rows, globalMobilisationFee],
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
    // Store lines verbatim while typing so spaces and blank lines survive.
    // normalizeSectionTerms() trims and drops empties on save.
    const lines = value.split('\n')
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

  function mergeSectionTerms(existing: SectionTerms, incoming?: SectionTerms): SectionTerms {
    if (!incoming) return existing
    const mergeList = (a: string[] | undefined, b: string[] | undefined) => {
      const seen = new Set<string>()
      const out: string[] = []
      for (const item of [...(a ?? []), ...(b ?? [])]) {
        const t = item.trim()
        if (!t || seen.has(t.toLowerCase())) continue
        seen.add(t.toLowerCase())
        out.push(t)
      }
      return out
    }
    return {
      included: mergeList(existing.included, incoming.included),
      excluded: mergeList(existing.excluded, incoming.excluded),
      assumptions: mergeList(existing.assumptions, incoming.assumptions),
      observed_contents: mergeList(existing.observed_contents, incoming.observed_contents),
    }
  }

  async function suggestSection(section: QuoteSuggestSection) {
    setSuggestingSection(section)
    setSuggestErrorBySection(prev => ({ ...prev, [section]: undefined }))
    try {
      const instruction = (sectionInstructions[section] ?? '').trim()
      const res = await fetch(`/api/jobs/${job.id}/quote-outcomes/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, section }),
      })
      const data = (await res.json()) as {
        rows?: OutcomeQuoteRow[]
        volume_rows?: VolumePricingRow[]
        surface_patches?: Array<{
          area_name: string
          surfaces?: Array<{ kind: SurfaceKind; included?: boolean; unit_price_per_sqm?: number }>
        }>
        terms?: SectionTerms
        error?: string
      }
      if (!res.ok) {
        setSuggestErrorBySection(prev => ({ ...prev, [section]: data.error ?? 'Suggest failed' }))
        return
      }

      if (section === 'outcomes') {
        if (!data.rows?.length) {
          setSuggestErrorBySection(prev => ({ ...prev, [section]: 'No outcomes returned' }))
          return
        }
        setRows(data.rows)
      } else if (section === 'volume') {
        if (!data.volume_rows?.length) {
          setSuggestErrorBySection(prev => ({ ...prev, [section]: 'No contents lines returned' }))
          return
        }
        setVolumePricing(prev => {
          const byArea = new Map(
            prev.rows
              .filter(r => (r.area_name ?? '').trim())
              .map(r => [(r.area_name ?? '').trim().toLowerCase(), r]),
          )
          const nextRows = [...prev.rows]
          for (const row of data.volume_rows ?? []) {
            const areaKey = (row.area_name ?? '').trim().toLowerCase()
            if (areaKey && byArea.has(areaKey)) {
              const idx = nextRows.findIndex(r => (r.area_name ?? '').trim().toLowerCase() === areaKey)
              if (idx !== -1) nextRows[idx] = { ...nextRows[idx], ...row, area_name: nextRows[idx].area_name }
            } else {
              nextRows.push(row)
            }
          }
          return recomputeVolumePricingTotal({ ...prev, rows: nextRows })
        })
        if (data.terms) setVolumePricingTerms(prev => mergeSectionTerms(prev, data.terms))
      } else {
        if (!data.surface_patches?.length && !data.terms) {
          setSuggestErrorBySection(prev => ({ ...prev, [section]: 'No surface pricing returned' }))
          return
        }
        if (data.surface_patches?.length) {
          setAreaPricing(prev =>
            prev.map(row => {
              const patch = data.surface_patches!.find(
                p => p.area_name.trim().toLowerCase() === row.area_name.trim().toLowerCase(),
              )
              if (!patch?.surfaces?.length) return row
              const surfaces = (row.surfaces ?? []).map(s => {
                const hit = patch.surfaces!.find(p => p.kind === s.kind)
                if (!hit) return s
                const unit = Math.max(0, Number(hit.unit_price_per_sqm ?? s.unit_price_per_sqm) || 0)
                const included = hit.included ?? s.included
                return {
                  ...s,
                  included,
                  unit_price_per_sqm: unit,
                  total: included ? toMoney(Number(s.area_m2 || 0) * unit) : 0,
                }
              })
              return { ...row, surfaces, total: sumIncludedSurfaceTotals(surfaces) }
            }),
          )
        }
        if (data.terms) setAreaPricingTerms(prev => mergeSectionTerms(prev, data.terms))
      }

      setSaved(false)
      setSaveError('')
    } catch (e) {
      setSuggestErrorBySection(prev => ({
        ...prev,
        [section]: e instanceof Error ? e.message : 'Suggest failed',
      }))
    } finally {
      setSuggestingSection(null)
    }
  }

  /** Assemble the active spoke's capture from the current editor state.
   *  Saving promotes priced AI-suggested rows to 'approved' so the builder,
   *  the generated doc body, and the totals stay in sync. */
  function buildActiveCapture(): OutcomeQuoteCapture {
    const cleanAreaTerms = normalizeSectionTerms(areaPricingTerms)
    const cleanVolumeTerms = normalizeSectionTerms(volumePricingTerms)
    const cleanOutcomesTerms = normalizeSectionTerms(outcomesSectionTerms)
    const persistedVolume = pricingLayout.per_m3_enabled || (volumePricing.rows.length > 0)
      ? recomputeVolumePricingTotal(volumePricing)
      : undefined
    const promotedRows: OutcomeQuoteRow[] = rows.map(r =>
      r.status === 'suggested' && Number(r.price || 0) > 0
        ? { ...r, status: 'approved' }
        : r,
    )
    return {
      mode: 'outcomes',
      quote_kind: quoteKind,
      rows: promotedRows,
      ...(cleanOutcomesTerms ? { outcomes_section_terms: cleanOutcomesTerms } : {}),
      area_pricing: areaPricing,
      ...(areaPricingSectionTotal > 0 ? { area_pricing_section_total: areaPricingSectionTotal } : {}),
      ...(cleanAreaTerms ? { area_pricing_terms: cleanAreaTerms } : {}),
      ...(persistedVolume ? { volume_pricing: persistedVolume } : {}),
      ...(cleanVolumeTerms ? { volume_pricing_terms: cleanVolumeTerms } : {}),
      pricing_layout: pricingLayout,
      global_mobilisation_fee: globalMobilisationFee,
      global_surface_rate_per_m2: globalSurfaceRatePerM2,
      global_contents_rate_per_m3: globalContentsRatePerM3,
      gst_mode: gstMode,
      totals: computeTotals(
        promotedRows,
        areaPricing,
        persistedVolume ?? null,
        pricingLayout,
        gstMode,
        globalMobilisationFee,
        areaPricingSectionTotal,
      ),
      target_pricing: {},
      validity,
      notes,
      authorisation: auth,
      last_reviewed_at: new Date().toISOString(),
    } satisfies OutcomeQuoteCapture
  }

  /** Fold the active editor state back into the spokes list (in-memory). */
  function commitActiveSpoke(list: QuoteSpoke[]): QuoteSpoke[] {
    const cap = buildActiveCapture()
    const now = new Date().toISOString()
    return list.map(s =>
      s.id === activeSpokeId
        ? { ...s, ...cap, id: s.id, label: s.label, created_at: s.created_at, updated_at: now }
        : s,
    )
  }

  function switchSpoke(targetId: string) {
    if (targetId === activeSpokeId) return
    const committed = commitActiveSpoke(spokes)
    const target = committed.find(s => s.id === targetId)
    setSpokes(committed)
    setActiveSpokeId(targetId)
    if (target) applyCapture(target)
    setSaved(false)
    setSaveError('')
  }

  function addSpoke() {
    const label = window.prompt('Name this quote', `Quote ${spokes.length + 1}`)
    if (label === null) return
    const committed = commitActiveSpoke(spokes)
    const spoke = makeBlankSpoke(label.trim() || `Quote ${spokes.length + 1}`)
    setSpokes([...committed, spoke])
    setActiveSpokeId(spoke.id)
    applyCapture(spoke)
    setSaved(false)
    setSaveError('')
  }

  function duplicateActiveSpoke() {
    const current = spokes.find(s => s.id === activeSpokeId)
    if (!current) return
    const label = window.prompt('Name the copy', `${current.label} (copy)`)
    if (label === null) return
    const committed = commitActiveSpoke(spokes)
    const source = committed.find(s => s.id === activeSpokeId) ?? current
    const now = new Date().toISOString()
    const copy: QuoteSpoke = {
      ...source,
      id: genQuoteSpokeId(),
      label: label.trim() || `${current.label} (copy)`,
      created_at: now,
      updated_at: now,
    }
    setSpokes([...committed, copy])
    setActiveSpokeId(copy.id)
    applyCapture(copy)
    setSaved(false)
    setSaveError('')
  }

  function renameActiveSpoke() {
    const current = spokes.find(s => s.id === activeSpokeId)
    if (!current) return
    const label = window.prompt('Rename quote', current.label)
    if (label === null) return
    const trimmed = label.trim()
    if (!trimmed) return
    setSpokes(prev => prev.map(s => (s.id === activeSpokeId ? { ...s, label: trimmed } : s)))
    setSaved(false)
    setSaveError('')
  }

  function deleteActiveSpoke() {
    if (spokes.length <= 1) return
    const current = spokes.find(s => s.id === activeSpokeId)
    if (!current) return
    if (!window.confirm(`Delete quote "${current.label}"? Documents already generated from it are unaffected.`)) return
    const remaining = spokes.filter(s => s.id !== activeSpokeId)
    const next = remaining[0]
    setSpokes(remaining)
    setActiveSpokeId(next.id)
    applyCapture(next)
    setSaved(false)
    setSaveError('')
  }

  /** Persist all spokes; mirror the active spoke into the legacy field so the
   *  existing live-merge / line-items / print paths for the active quote keep
   *  working. Returns the updated Job on success, else null. */
  async function save(): Promise<Job | null> {
    setSaving(true)
    setSaved(false)
    setSaveError('')
    try {
      const cap = buildActiveCapture()
      const now = new Date().toISOString()
      const nextSpokes: QuoteSpoke[] = spokes.map(s =>
        s.id === activeSpokeId
          ? { ...s, ...cap, id: s.id, label: s.label, created_at: s.created_at, updated_at: now }
          : s,
      )
      const merged = { ...(ad ?? {}) } as Record<string, unknown>
      merged.payment_terms = paymentTerms
      merged.outcome_quotes = nextSpokes
      merged.outcome_quote_capture = cap
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: merged }),
      })
      const data = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !data.job) {
        setSaveError(data.error ?? `Save failed (${res.status})`)
        return null
      }
      setRows(cap.rows)
      setSpokes(nextSpokes)
      onJobUpdate(data.job)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      return data.job
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
      return null
    } finally {
      setSaving(false)
    }
  }

  /** Save, then open the document composer for this spoke (frozen snapshot). */
  async function saveAndOpenDocument() {
    const updated = await save()
    if (updated) {
      router.push(`/jobs/${job.id}/docs/quote?compose=1&quoteId=${encodeURIComponent(activeSpokeId)}`)
    }
  }

  return (
    <div style={{ maxWidth: 720, paddingBottom: 40 }}>
      {/* ── Quote selector (hub-and-spoke) ───────────────────────────────────
        * The Assessment data is the shared hub; each quote here is an
        * independent spoke with its own pricing. One spoke is edited at a
        * time; "Save as document" freezes the selected spoke into a PDF. */}
      <div
        style={{
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          borderRadius: 12,
          padding: 12,
          marginBottom: 18,
        }}
      >
        <div style={{ ...SECTION, marginBottom: 8 }}>Quotes for this job</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={activeSpokeId}
            onChange={e => switchSpoke(e.target.value)}
            aria-label="Select quote"
            style={{
              flex: '1 1 220px',
              minWidth: 0,
              fontSize: 14,
              fontWeight: 700,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            {spokes.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 10px' }} onClick={addSpoke}>
              + New
            </button>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 10px' }} onClick={duplicateActiveSpoke}>
              Duplicate
            </button>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 10px' }} onClick={renameActiveSpoke}>
              Rename
            </button>
            <button
              type="button"
              onClick={deleteActiveSpoke}
              disabled={spokes.length <= 1}
              title={spokes.length <= 1 ? 'A job keeps at least one quote' : 'Delete this quote'}
              style={{
                fontSize: 12,
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid #F87171',
                background: 'none',
                color: '#F87171',
                cursor: spokes.length <= 1 ? 'not-allowed' : 'pointer',
                opacity: spokes.length <= 1 ? 0.4 : 1,
              }}
            >
              Delete
            </button>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
          {spokes.length === 1
            ? 'One quote for this job. Add another for a separate part (e.g. mould remediation vs contents removal).'
            : `${spokes.length} quotes. Each is priced independently and prints as its own document.`}
        </div>
      </div>

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

      {/* ── Document identity (Quote vs Estimate) ────────────────────────
        * Drives the in-doc banner ("THIS IS A FIXED-PRICE QUOTE" vs
        * "THIS IS AN ESTIMATE") and the reference prefix (QUO- vs EST-).
        * Title stays "Quote/Estimate" in either case so the doc category
        * is consistent. Stored as outcome_quote_capture.quote_kind. */}
      <div style={{ marginBottom: 18 }}>
        <div style={SECTION}>Document type</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6, marginBottom: 8, lineHeight: 1.5 }}>
          Pick which commercial commitment this document makes. The generated PDF is titled
          <strong style={{ color: 'var(--text)' }}> Quote/Estimate</strong> in either case;
          a banner near the top of the doc tells the client which it is.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {([
            {
              key: 'quote' as const,
              label: 'Fixed-price Quote',
              sub: 'Total is the agreed price. Not subject to variation unless scope changes in writing.',
              activeColor: '#1d4ed8',
              activeBg: 'rgba(29,78,216,0.18)',
              activeBorder: 'rgba(29,78,216,0.55)',
            },
            {
              key: 'estimate' as const,
              label: 'Estimate',
              sub: 'Reconciled at completion against actual volumes / weighbridge receipts; variance billed or credited.',
              activeColor: '#d97706',
              activeBg: 'rgba(217,119,6,0.18)',
              activeBorder: 'rgba(217,119,6,0.55)',
            },
          ]).map(opt => {
            const active = quoteKind === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => { setQuoteKind(opt.key); setSaved(false); setSaveError('') }}
                aria-pressed={active}
                style={{
                  textAlign: 'left',
                  borderRadius: 9,
                  border: `1px solid ${active ? opt.activeBorder : 'var(--border)'}`,
                  background: active ? opt.activeBg : 'var(--surface-2)',
                  color: 'var(--text)',
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-block',
                      width: 14, height: 14, borderRadius: '50%',
                      border: `2px solid ${active ? opt.activeColor : 'var(--border)'}`,
                      background: active ? opt.activeColor : 'transparent',
                      boxShadow: active ? `inset 0 0 0 2px var(--surface-2)` : 'none',
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 800 }}>{opt.label}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}>{opt.sub}</div>
              </button>
            )
          })}
        </div>
      </div>

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
        <div
          style={{
            marginTop: 10,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(140px, 1fr))',
            gap: 10,
            alignItems: 'end',
          }}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Global mobilisation fee</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={globalMobilisationFee > 0 ? globalMobilisationFee : ''}
              onChange={e => {
                const n = parseFloat(e.target.value)
                setGlobalMobilisationFee(isNaN(n) ? 0 : Math.max(0, n))
                setSaved(false)
                setSaveError('')
              }}
              placeholder="0.00"
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Global $/m³ rate</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={globalContentsRatePerM3 > 0 ? globalContentsRatePerM3 : ''}
              onChange={e => {
                const n = parseFloat(e.target.value)
                setGlobalContentsRatePerM3(isNaN(n) ? 0 : Math.max(0, n))
                setSaved(false)
                setSaveError('')
              }}
              placeholder="0.00"
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Global $/m² rate</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={globalSurfaceRatePerM2 > 0 ? globalSurfaceRatePerM2 : ''}
              onChange={e => {
                const n = parseFloat(e.target.value)
                setGlobalSurfaceRatePerM2(isNaN(n) ? 0 : Math.max(0, n))
                setSaved(false)
                setSaveError('')
              }}
              placeholder="0.00"
            />
          </div>
          <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Mobilisation is the Section 1 base fee and source of truth for attendance/setup. $/m³ is a reference rate for contents/disposal and is not used to estimate volume. $/m² displays calculated surface pricing inside each item.
          </div>
        </div>
      </div>

      {pricingLayout.outcomes_enabled && (
      <>
      {/* ── Section 1 — Mobilisation, Fees & Fixed-Rate Items ── */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={SECTION}>1. Mobilisation, Fees &amp; Fixed-Rate Items</div>
          {(rows.length > 0 || globalMobilisationFee > 0) && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Subtotal: <strong style={{ color: 'var(--text)' }}>${outcomesSubtotal.toFixed(2)}</strong>
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6, marginBottom: 12, lineHeight: 1.5 }}>
          Call-out, dispatch, project management, surcharges, certificates, and fixed-fee scopes.
        </div>
      </div>

      {globalMobilisationFee > 0 && (
        <div
          style={{
            border: '1px solid rgba(255,107,53,0.35)',
            borderRadius: 10,
            padding: '10px 12px',
            background: 'rgba(255,107,53,0.06)',
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 4 }}>
            Base pricing determinant
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 700 }}>
            Mobilisation fee: ${globalMobilisationFee.toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 4 }}>
            Downstream mobilisation rows should add surcharges or modifiers, not redefine this base fee.
          </div>
        </div>
      )}

      <QuoteSectionAiPanel
        section="outcomes"
        instruction={sectionInstructions.outcomes}
        onInstructionChange={v => setSectionInstructions(prev => ({ ...prev, outcomes: v }))}
        onSuggest={() => void suggestSection('outcomes')}
        suggesting={suggestingSection === 'outcomes'}
        error={suggestErrorBySection.outcomes ?? ''}
      />

      <SectionObservedContentsField
        terms={outcomesSectionTerms}
        onChange={(field, value) => patchSectionTerms(setOutcomesSectionTerms, field, value)}
      />

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
          No items yet — use Suggest, or add a Mobilisation / Project Management / Surcharge / Fixed-fee action below.
        </div>
      )}

      <div style={{ display: 'grid', gap: 14, marginBottom: 14 }}>
        {rows.map((row, idx) => {
          const matchedAreas = selectedAreasForRow(row, ad?.areas)
          const totalSurfaceM2 = totalSurfaceM2ForAreas(matchedAreas)
          const calculatedSurfacePrice = toMoney(totalSurfaceM2 * globalSurfaceRatePerM2)
          const missingAreaNames = (row.areas ?? []).filter(name =>
            !matchedAreas.some(area => area.name.trim().toLowerCase() === name.trim().toLowerCase()),
          )
          return (
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
                <label>Proposed action</label>
                <AutoGrow
                  value={row.outcome_title}
                  onChange={v => patchRow(row.id, { outcome_title: v })}
                  placeholder="e.g. Remove visibly affected carpet from the nominated primary contamination zone"
                  rows={1}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Room / area / zone</label>
                <AutoGrow
                  value={row.areas.join(', ')}
                  onChange={v => patchRow(row.id, { areas: parseAreasInput(v) })}
                  placeholder="Bedroom, hallway, primary contamination zone"
                  rows={1}
                />
              </div>
            </div>

            <div className="field" style={{ marginBottom: 8 }}>
              <label>Action details</label>
              <AutoGrow
                value={row.outcome_description}
                onChange={v => patchRow(row.id, { outcome_description: v })}
                placeholder="Proposed activities only — e.g. establish work area, relocate movable furniture, remove visibly affected material, bag and transport materials."
                rows={2}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Observed / reported contents</label>
                <AutoGrow
                  value={(row.contents ?? []).join('\n')}
                  onChange={v => patchRow(row.id, { contents: v.split('\n') })}
                  placeholder={OBSERVED_CONTENTS_PLACEHOLDER}
                  rows={4}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Room measurements / surface area</label>
                <div style={{
                  minHeight: 104,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  lineHeight: 1.55,
                }}>
                  {matchedAreas.length === 0 ? (
                    <div>
                      {(row.areas ?? []).length > 0
                        ? 'No matching assessment room dimensions found for this item.'
                        : 'Add a room name in Room / Area / Zone to show dimensions from Assessment.'}
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {matchedAreas.map(area => {
                        const m = areaSurfaceMeasurements(area)
                        const dims = m.length > 0 && m.width > 0
                          ? `${m.length}m L × ${m.width}m W${m.height > 0 ? ` × ${m.height}m H` : ''}`
                          : 'Dimensions not captured'
                        return (
                          <div key={area.name}>
                            <div style={{ color: 'var(--text)', fontWeight: 700 }}>{area.name}</div>
                            <div>Room dimensions: {dims}</div>
                            <div>Surface area: Ceiling {fmtM2(m.ceiling)} · Walls {fmtM2(m.walls)} · Floor {fmtM2(m.floor)}</div>
                            <div style={{ color: 'var(--text)', fontWeight: 600 }}>Total: {fmtM2(m.total)}</div>
                          </div>
                        )
                      })}
                      {missingAreaNames.length > 0 && (
                        <div style={{ color: '#FBBF24' }}>
                          No assessment dimensions for: {missingAreaNames.join(', ')}
                        </div>
                      )}
                      {globalSurfaceRatePerM2 > 0 && totalSurfaceM2 > 0 && (
                        <div
                          style={{
                            marginTop: 2,
                            paddingTop: 8,
                            borderTop: '1px solid var(--border)',
                            color: 'var(--text)',
                            fontWeight: 700,
                          }}
                        >
                          Calculated surface price: {fmtM2(totalSurfaceM2)} × ${globalSurfaceRatePerM2.toFixed(2)} = ${calculatedSurfacePrice.toFixed(2)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
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
                <label>Included actions</label>
                <AutoGrow
                  value={(row.included ?? []).join('\n')}
                  onChange={v => patchRow(row.id, { included: v.split('\n') })}
                  placeholder="One per line — actions included in this item"
                  rows={2}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Excluded / outside scope</label>
                <AutoGrow
                  value={(row.excluded ?? []).join('\n')}
                  onChange={v => patchRow(row.id, { excluded: v.split('\n') })}
                  placeholder="One per line — excluded works, other zones, unrelated odours, concealed conditions"
                  rows={2}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Assumptions / unknowns</label>
                <AutoGrow
                  value={(row.assumptions ?? []).join('\n')}
                  onChange={v => patchRow(row.id, { assumptions: v.split('\n') })}
                  placeholder="One per line — assumptions and unknowns this price relies on"
                  rows={2}
                />
              </div>
            </div>
          </div>
          )
        })}
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

      <QuoteSectionAiPanel
        section="volume"
        instruction={sectionInstructions.volume}
        onInstructionChange={v => setSectionInstructions(prev => ({ ...prev, volume: v }))}
        onSuggest={() => void suggestSection('volume')}
        suggesting={suggestingSection === 'volume'}
        error={suggestErrorBySection.volume ?? ''}
      />

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

      <SectionObservedContentsField
        terms={volumePricingTerms}
        onChange={(field, value) => patchSectionTerms(setVolumePricingTerms, field, value)}
      />

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
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Subtotal: <strong style={{ color: 'var(--text)' }}>${areaPricingSubtotal.toFixed(2)}</strong>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6, marginBottom: 12, lineHeight: 1.5 }}>
          Per-m² surface pricing driven by the Assessment dimensions. Floor / Walls / Ceiling priced independently.
        </div>
      </div>

      <QuoteSectionAiPanel
        section="surface"
        instruction={sectionInstructions.surface}
        onInstructionChange={v => setSectionInstructions(prev => ({ ...prev, surface: v }))}
        onSuggest={() => void suggestSection('surface')}
        suggesting={suggestingSection === 'surface'}
        error={suggestErrorBySection.surface ?? ''}
      />

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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 14 }}>
        <div className="field" style={{ marginBottom: 0, flex: '0 0 200px' }}>
          <label>Section total ($)</label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={areaPricingSectionTotal > 0 ? areaPricingSectionTotal : ''}
            onChange={e => {
              const n = parseFloat(e.target.value)
              setAreaPricingSectionTotal(isNaN(n) ? 0 : Math.max(0, n))
              setSaved(false)
              setSaveError('')
            }}
            placeholder="0.00"
            disabled={areaPricingSurfaceSubtotal > 0}
            aria-label="Section 3 total price"
          />
        </div>
        {areaPricingSurfaceSubtotal > 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45, paddingBottom: 8 }}>
            Total is the sum of included surface lines (${areaPricingSurfaceSubtotal.toFixed(2)}).
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45, paddingBottom: 8 }}>
            Enter a lump-sum total when not pricing per surface, or add areas in Assessment for per-m² lines.
          </div>
        )}
      </div>

      <SectionObservedContentsField
        terms={areaPricingTerms}
        onChange={(field, value) => patchSectionTerms(setAreaPricingTerms, field, value)}
      />

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
        {(pricingLayout.outcomes_enabled || pricingLayout.per_m3_enabled || pricingLayout.per_sqm_enabled) && (
          <div
            style={{
              marginBottom: 12,
              paddingBottom: 12,
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Section summary</div>
            {pricingLayout.outcomes_enabled && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--text-muted)' }}>1. Mobilisation &amp; fees</span>
                <span>${outcomesSubtotal.toFixed(2)}</span>
              </div>
            )}
            {pricingLayout.per_m3_enabled && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--text-muted)' }}>2. Contents removal</span>
                <span>${volumeSubtotal.toFixed(2)}</span>
              </div>
            )}
            {pricingLayout.per_sqm_enabled && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--text-muted)' }}>3. Remediation &amp; cleaning</span>
                <span>${areaPricingSubtotal.toFixed(2)}</span>
              </div>
            )}
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
        <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 8px', lineHeight: 1.5 }}>
          Rendered as a highlighted callout in the printed quote — use bold and bullets
          for deposit amounts, balance, and reconciliation rules so the client can scan it.
        </div>
        <RichTextEditor
          value={paymentTerms}
          onChange={html => { setPaymentTerms(html); setSaved(false); setSaveError('') }}
          minHeight={200}
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
        <label>Authorisation to Proceed</label>
        <div style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          margin: '6px 0 10px',
          lineHeight: 1.5,
          padding: '12px 14px',
          borderRadius: 8,
          border: '1px solid rgba(249,115,22,0.35)',
          borderLeft: '4px solid #F97316',
          background: 'rgba(249,115,22,0.1)',
        }}>
          <div style={{ fontWeight: 700, color: '#FDBA74', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Authorisation to Proceed</div>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>To accept this quote and proceed with booking, please complete the following steps:</div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>With pen and paper, write out the authorisation text exactly as shown below.</li>
            <li>Sign and date the handwritten authorisation.</li>
            <li>Take a clear photo and email it to <strong style={{ color: 'var(--text)' }}>admin@brisbanebiohazardcleaning.com.au</strong>.</li>
          </ol>
        </div>
        <RichTextEditor
          value={auth.acceptance_statement}
          onChange={html => patchAuth({ acceptance_statement: html })}
          minHeight={240}
        />
      </div>

      {/* ── Save ── */}
      {saveError && (
        <div style={{ fontSize: 13, color: '#F87171', marginBottom: 10, lineHeight: 1.45 }} role="alert">
          {saveError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={saving}
          style={{ flex: 2, padding: 14, fontSize: 15, touchAction: 'manipulation' }}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save progress'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={saveAndOpenDocument}
          disabled={saving}
          title="Save, then open the printable document for this quote"
          style={{ flex: 3, padding: 14, fontSize: 15, touchAction: 'manipulation' }}
        >
          Save as document →
        </button>
      </div>
    </div>
  )
}
