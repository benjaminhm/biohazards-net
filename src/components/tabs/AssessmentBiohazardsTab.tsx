/*
 * Assessment → Hazards. Identify (Presentation-only, strict) and Generate (from presenting risks).
 * Presenting area; autosave on +/-.
 */
'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AssessmentData, Job, SuggestedRiskAiItem, SuggestedRiskCategory } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { applyHazardDemotionOrRemoval, risksReferencingHazard } from '@/lib/riskHazardLinks'

const BUBBLE_THEME: Record<
  SuggestedRiskCategory,
  { bg: string; border: string; color: string }
> = {
  biological: { bg: 'rgba(248, 113, 113, 0.18)', border: 'rgba(248, 113, 113, 0.45)', color: '#FCA5A5' },
  chemical: { bg: 'rgba(167, 139, 250, 0.18)', border: 'rgba(167, 139, 250, 0.45)', color: '#C4B5FD' },
  physical: { bg: 'rgba(251, 191, 36, 0.18)', border: 'rgba(251, 191, 36, 0.45)', color: '#FCD34D' },
  environmental: { bg: 'rgba(52, 211, 153, 0.16)', border: 'rgba(52, 211, 153, 0.4)', color: '#6EE7B7' },
  operational: { bg: 'rgba(96, 165, 250, 0.18)', border: 'rgba(96, 165, 250, 0.45)', color: '#93C5FD' },
}

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
}

function HazardBubble({
  item,
  prefix,
  actionLabel,
  onClick,
  disabled = false,
}: {
  item: SuggestedRiskAiItem
  prefix: '+' | '-'
  actionLabel: string
  onClick: () => void
  disabled?: boolean
}) {
  const t = BUBBLE_THEME[item.category] ?? BUBBLE_THEME.operational
  return (
    <button
      type="button"
      title={item.category}
      aria-label={`${actionLabel} ${item.label}`}
      onClick={onClick}
      disabled={disabled}
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
        maxWidth: '100%',
        wordBreak: 'break-word',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.75 : 1,
      }}
    >
      <span style={{ fontWeight: 800, flexShrink: 0 }} aria-hidden>
        {prefix}
      </span>
      <span>{item.label}</span>
    </button>
  )
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

export default function AssessmentBiohazardsTab({ job, onJobUpdate }: Props) {
  const [identifyLoading, setIdentifyLoading] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [identifyError, setIdentifyError] = useState('')
  const [generateError, setGenerateError] = useState('')
  const [presentingIds, setPresentingIds] = useState<string[]>([])
  const [moveSaving, setMoveSaving] = useState(false)
  const [draftLabel, setDraftLabel] = useState('')
  const [manualSaving, setManualSaving] = useState(false)

  const identifiedItems = useMemo(
    () => job.assessment_data?.identified_biohazards_ai?.items ?? [],
    [job.assessment_data?.identified_biohazards_ai?.items]
  )
  const generatedItems = useMemo(
    () => job.assessment_data?.suggested_biohazards_ai?.items ?? [],
    [job.assessment_data?.suggested_biohazards_ai?.items]
  )
  const manualItems = useMemo(
    () => job.assessment_data?.manual_biohazard_chips ?? [],
    [job.assessment_data?.manual_biohazard_chips]
  )

  const allById = useMemo(() => {
    const m = new Map<string, SuggestedRiskAiItem>()
    for (const i of identifiedItems) m.set(i.id, i)
    for (const i of generatedItems) {
      if (!m.has(i.id)) m.set(i.id, i)
    }
    for (const i of manualItems) m.set(i.id, i)
    return m
  }, [identifiedItems, generatedItems, manualItems])

  const allItems = useMemo(() => [...allById.values()], [allById])

  useEffect(() => {
    const savedIds = job.assessment_data?.presenting_biohazard_ids ?? []
    const aiIdSet = new Set(allItems.map(i => i.id))
    setPresentingIds(savedIds.filter(id => aiIdSet.has(id)))
  }, [job.id, job.updated_at, job.assessment_data?.presenting_biohazard_ids, allItems])

  const identifiedSuggested = identifiedItems.filter(item => !presentingIds.includes(item.id))
  const generatedSuggested = generatedItems.filter(item => !presentingIds.includes(item.id))
  const manualSuggested = manualItems.filter(item => !presentingIds.includes(item.id))
  const presentingItems = presentingIds.map(id => allById.get(id)).filter(Boolean) as SuggestedRiskAiItem[]

  const busy = identifyLoading || generateLoading

  async function persistPresentingBiohazardIds(nextIds: string[], prevIds: string[]) {
    setPresentingIds(nextIds)
    setMoveSaving(true)
    try {
      const demotedIds = prevIds.filter(id => !nextIds.includes(id))
      let mergedAssessment: AssessmentData = {
        ...mergeAssessmentData(job.assessment_data),
        ...(job.assessment_data ?? {}),
        presenting_biohazard_ids: nextIds,
      }
      for (const hid of demotedIds) {
        mergedAssessment = applyHazardDemotionOrRemoval(mergedAssessment, hid)
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: mergedAssessment }),
      })
      const payload = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !payload.job) throw new Error(payload.error ?? 'Could not save presenting hazards')
      onJobUpdate(payload.job)
    } catch (e: unknown) {
      setPresentingIds(prevIds)
      window.alert(e instanceof Error ? e.message : 'Could not save presenting hazards')
    } finally {
      setMoveSaving(false)
    }
  }

  function moveToPresenting(id: string) {
    if (moveSaving) return
    const prev = presentingIds
    if (prev.includes(id)) return
    const next = [...prev, id]
    void persistPresentingBiohazardIds(next, prev)
  }

  function moveToSuggested(id: string) {
    if (moveSaving) return
    const prev = presentingIds
    const next = prev.filter(x => x !== id)
    const linked = risksReferencingHazard(job.assessment_data, id)
    if (linked.length > 0) {
      const ok = window.confirm(
        `This hazard is linked to ${linked.length} risk chip(s) on the Risks tab. Removing it from Presenting will update or remove those risks (risks that only referenced this hazard will be removed). Continue?`
      )
      if (!ok) return
    }
    void persistPresentingBiohazardIds(next, prev)
  }

  async function runIdentify() {
    setIdentifyLoading(true)
    setIdentifyError('')
    try {
      const res = await fetch(`/api/jobs/${job.id}/identify-biohazards`, { method: 'POST' })
      const payload = await res.json()
      if (!res.ok || payload.error) throw new Error(payload.error ?? 'Identify failed')
      if (payload.job) onJobUpdate(payload.job)
    } catch (e: unknown) {
      setIdentifyError(e instanceof Error ? e.message : 'Identify failed')
    } finally {
      setIdentifyLoading(false)
    }
  }

  async function runGenerate() {
    setGenerateLoading(true)
    setGenerateError('')
    try {
      const res = await fetch(`/api/jobs/${job.id}/suggest-biohazards`, { method: 'POST' })
      const payload = await res.json()
      if (!res.ok || payload.error) throw new Error(payload.error ?? 'Could not generate suggestions')
      if (payload.job) onJobUpdate(payload.job)
    } catch (e: unknown) {
      setGenerateError(e instanceof Error ? e.message : 'Could not generate suggestions')
    } finally {
      setGenerateLoading(false)
    }
  }

  async function addManualBiohazard() {
    const label = draftLabel.replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!label) return
    const prev = job.assessment_data?.manual_biohazard_chips ?? []
    if (prev.some(i => i.label.toLowerCase() === label.toLowerCase())) {
      window.alert('That hazard label is already in your custom list.')
      return
    }
    setManualSaving(true)
    try {
      const id = `man_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
      const nextChip: SuggestedRiskAiItem = { id, label, category: 'operational' }
      const mergedAssessment: AssessmentData = {
        ...mergeAssessmentData(job.assessment_data),
        ...(job.assessment_data ?? {}),
        manual_biohazard_chips: [...prev, nextChip],
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: mergedAssessment }),
      })
      const payload = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !payload.job) throw new Error(payload.error ?? 'Could not save custom hazard')
      onJobUpdate(payload.job)
      setDraftLabel('')
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Could not save custom hazard')
    } finally {
      setManualSaving(false)
    }
  }

  async function removeManualBiohazard(id: string) {
    const linked = risksReferencingHazard(job.assessment_data, id)
    if (linked.length > 0) {
      const ok = window.confirm(
        `This hazard is linked to ${linked.length} risk chip(s) on the Risks tab. Removing it will update or remove those risks. Continue?`
      )
      if (!ok) return
    }
    setManualSaving(true)
    try {
      const prev = job.assessment_data?.manual_biohazard_chips ?? []
      const manual_biohazard_chips = prev.filter(i => i.id !== id)
      const presenting_biohazard_ids = (job.assessment_data?.presenting_biohazard_ids ?? []).filter(pid => pid !== id)
      let mergedAssessment: AssessmentData = {
        ...mergeAssessmentData(job.assessment_data),
        ...(job.assessment_data ?? {}),
        manual_biohazard_chips,
        presenting_biohazard_ids,
      }
      mergedAssessment = applyHazardDemotionOrRemoval(mergedAssessment, id)
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: mergedAssessment }),
      })
      const payload = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !payload.job) throw new Error(payload.error ?? 'Could not remove custom hazard')
      onJobUpdate(payload.job)
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Could not remove custom hazard')
    } finally {
      setManualSaving(false)
    }
  }

  const hasAnyChips = allItems.length > 0

  return (
    <div style={{ paddingBottom: 40 }}>
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
          Hazard candidates
        </div>
        <div
          className="card"
          style={{
            padding: '16px',
            marginBottom: 12,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 180,
          }}
        >
          {(identifyError || generateError) && (
            <div style={{ fontSize: 12, color: '#F87171', marginBottom: 10 }}>
              {identifyError && <div>{identifyError}</div>}
              {generateError && <div>{generateError}</div>}
            </div>
          )}

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 12, minHeight: 48 }}>
            <div>
              <Subheading>Identified from Presentation</Subheading>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignContent: 'flex-start' }}>
                {identifiedItems.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    None yet. Press Identify (uses Assessment → Presentation text and photos only).
                  </div>
                ) : identifiedSuggested.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    All identified chips moved to Presenting hazards.
                  </div>
                ) : (
                  identifiedSuggested.map(item => (
                    <HazardBubble
                      key={item.id}
                      item={item}
                      prefix="+"
                      actionLabel="Add"
                      onClick={() => moveToPresenting(item.id)}
                      disabled={moveSaving || manualSaving}
                    />
                  ))
                )}
              </div>
            </div>

            <div>
              <Subheading>Suggested from presenting risks</Subheading>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignContent: 'flex-start' }}>
                {generatedItems.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    None yet. Promote risks on the Risks tab, then press Generate.
                  </div>
                ) : generatedSuggested.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    All suggested chips moved to Presenting hazards.
                  </div>
                ) : (
                  generatedSuggested.map(item => (
                    <HazardBubble
                      key={item.id}
                      item={item}
                      prefix="+"
                      actionLabel="Add"
                      onClick={() => moveToPresenting(item.id)}
                      disabled={moveSaving || manualSaving}
                    />
                  ))
                )}
              </div>
            </div>

            <div>
              <Subheading>Custom (manual)</Subheading>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <textarea
                  value={draftLabel}
                  onChange={e => setDraftLabel(e.target.value)}
                  placeholder="Exact wording for this job…"
                  maxLength={120}
                  rows={3}
                  disabled={manualSaving || busy || moveSaving}
                  style={{
                    width: '100%',
                    minWidth: 0,
                    minHeight: 72,
                    resize: 'vertical',
                    fontSize: 13,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontFamily: 'inherit',
                    lineHeight: 1.4,
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    disabled={manualSaving || busy || moveSaving || !draftLabel.trim()}
                    onClick={() => void addManualBiohazard()}
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      padding: '8px 14px',
                      borderRadius: 8,
                      background: 'var(--accent)',
                      color: '#fff',
                      border: 'none',
                      cursor: manualSaving || !draftLabel.trim() ? 'not-allowed' : 'pointer',
                      opacity: manualSaving || !draftLabel.trim() ? 0.6 : 1,
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                {manualItems.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Add your own hazard label when AI suggestions are close but not quite right.
                  </div>
                ) : manualSuggested.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    All custom chips moved to Presenting hazards. Remove from Presenting to edit list here.
                  </div>
                ) : (
                  manualSuggested.map(item => (
                    <div key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <HazardBubble
                        item={item}
                        prefix="+"
                        actionLabel="Add"
                        onClick={() => moveToPresenting(item.id)}
                        disabled={moveSaving || manualSaving}
                      />
                      <button
                        type="button"
                        title="Remove custom hazard"
                        disabled={manualSaving || moveSaving}
                        onClick={() => void removeManualBiohazard(item.id)}
                        style={{
                          fontSize: 12,
                          color: 'var(--text-muted)',
                          background: 'none',
                          border: 'none',
                          cursor: manualSaving ? 'not-allowed' : 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {!hasAnyChips && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Use Identify for strict Presentation-based themes, or Generate for themes derived from presenting risks.
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 10,
              marginTop: 'auto',
              flexShrink: 0,
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              disabled={busy || moveSaving || manualSaving}
              onClick={runIdentify}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: '10px 18px',
                borderRadius: 9,
                background: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                opacity: busy || moveSaving ? 0.75 : 1,
                cursor: busy || moveSaving ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {identifyLoading ? (
                <>
                  <span
                    className="spinner"
                    style={{
                      width: 14,
                      height: 14,
                      borderColor: 'rgba(255,255,255,0.15)',
                      borderTopColor: 'var(--accent)',
                    }}
                  />{' '}
                  Identifying…
                </>
              ) : (
                'Identify'
              )}
            </button>
            <button
              type="button"
              disabled={busy || moveSaving || manualSaving}
              onClick={runGenerate}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: '10px 18px',
                borderRadius: 9,
                background: 'var(--green)',
                color: '#fff',
                border: '1px solid rgba(34, 197, 94, 0.45)',
                opacity: busy || moveSaving || manualSaving ? 0.75 : 1,
                cursor: busy || moveSaving || manualSaving ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {generateLoading ? (
                <>
                  <span
                    className="spinner"
                    style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,0.25)', borderTopColor: 'rgba(255,255,255,0.85)' }}
                  />{' '}
                  Generating…
                </>
              ) : (
                'Generate'
              )}
            </button>
          </div>
        </div>
      </section>

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
          Presenting hazards
        </div>
        <div
          style={{
            minHeight: 140,
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--surface)',
            padding: 16,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignContent: 'flex-start',
          }}
        >
          {presentingItems.map(item => (
            <HazardBubble
              key={item.id}
              item={item}
              prefix="-"
              actionLabel="Remove"
              onClick={() => moveToSuggested(item.id)}
              disabled={moveSaving || manualSaving}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
