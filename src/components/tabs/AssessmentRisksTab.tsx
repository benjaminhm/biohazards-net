/*
 * Assessment → Risks. Identify / Generate use approved presenting hazards + Presentation
 * context; chips may carry source_hazard_ids. Presenting area; autosave on +/-.
 */
'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AssessmentData, Job, SuggestedRiskAiItem, SuggestedRiskCategory } from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'
import { orphanRiskItems, pruneOrphanRisks } from '@/lib/riskHazardLinks'

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

function RiskBubble({
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
  const tip =
    item.source_hazard_ids?.length
      ? `${item.category} · linked to ${item.source_hazard_ids.length} approved hazard(s)`
      : item.category
  return (
    <button
      type="button"
      title={tip}
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

export default function AssessmentRisksTab({ job, onJobUpdate }: Props) {
  const [identifyLoading, setIdentifyLoading] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [identifyError, setIdentifyError] = useState('')
  const [generateError, setGenerateError] = useState('')
  const [presentingRiskIds, setPresentingRiskIds] = useState<string[]>([])
  const [moveSaving, setMoveSaving] = useState(false)
  const [draftLabel, setDraftLabel] = useState('')
  const [manualSaving, setManualSaving] = useState(false)
  const [pruneSaving, setPruneSaving] = useState(false)

  const identifiedItems = useMemo(
    () => job.assessment_data?.identified_risks_ai?.items ?? [],
    [job.assessment_data?.identified_risks_ai?.items]
  )
  const generatedItems = useMemo(
    () => job.assessment_data?.suggested_risks_ai?.items ?? [],
    [job.assessment_data?.suggested_risks_ai?.items]
  )
  const manualItems = useMemo(
    () => job.assessment_data?.manual_risk_chips ?? [],
    [job.assessment_data?.manual_risk_chips]
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
    const savedIds = job.assessment_data?.presenting_risk_ids ?? []
    const aiIdSet = new Set(allItems.map(i => i.id))
    setPresentingRiskIds(savedIds.filter(id => aiIdSet.has(id)))
  }, [job.id, job.updated_at, job.assessment_data?.presenting_risk_ids, allItems])

  const identifiedSuggested = identifiedItems.filter(item => !presentingRiskIds.includes(item.id))
  const generatedSuggested = generatedItems.filter(item => !presentingRiskIds.includes(item.id))
  const manualSuggested = manualItems.filter(item => !presentingRiskIds.includes(item.id))
  const presentingItems = presentingRiskIds.map(id => allById.get(id)).filter(Boolean) as SuggestedRiskAiItem[]

  const busy = identifyLoading || generateLoading

  const hasApprovedHazards = (job.assessment_data?.presenting_biohazard_ids?.length ?? 0) > 0
  const orphanRisks = useMemo(
    () => orphanRiskItems(job.assessment_data),
    [job.assessment_data]
  )

  async function persistPresentingRiskIds(nextIds: string[], prevIds: string[]) {
    setPresentingRiskIds(nextIds)
    setMoveSaving(true)
    try {
      const mergedAssessment: AssessmentData = {
        ...mergeAssessmentData(job.assessment_data),
        ...(job.assessment_data ?? {}),
        presenting_risk_ids: nextIds,
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: mergedAssessment }),
      })
      const payload = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !payload.job) throw new Error(payload.error ?? 'Could not save presenting risks')
      onJobUpdate(payload.job)
    } catch (e: unknown) {
      setPresentingRiskIds(prevIds)
      window.alert(e instanceof Error ? e.message : 'Could not save presenting risks')
    } finally {
      setMoveSaving(false)
    }
  }

  function moveToPresenting(id: string) {
    if (moveSaving) return
    const prev = presentingRiskIds
    if (prev.includes(id)) return
    const next = [...prev, id]
    void persistPresentingRiskIds(next, prev)
  }

  function moveToSuggested(id: string) {
    if (moveSaving) return
    const prev = presentingRiskIds
    const next = prev.filter(x => x !== id)
    void persistPresentingRiskIds(next, prev)
  }

  async function runIdentify() {
    setIdentifyLoading(true)
    setIdentifyError('')
    try {
      const res = await fetch(`/api/jobs/${job.id}/identify-risks`, { method: 'POST' })
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
      const res = await fetch(`/api/jobs/${job.id}/suggest-risks`, { method: 'POST' })
      const payload = await res.json()
      if (!res.ok || payload.error) throw new Error(payload.error ?? 'Could not generate suggestions')
      if (payload.job) onJobUpdate(payload.job)
    } catch (e: unknown) {
      setGenerateError(e instanceof Error ? e.message : 'Could not generate suggestions')
    } finally {
      setGenerateLoading(false)
    }
  }

  async function addManualRisk() {
    const label = draftLabel.replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!label) return
    const prev = job.assessment_data?.manual_risk_chips ?? []
    if (prev.some(i => i.label.toLowerCase() === label.toLowerCase())) {
      window.alert('That risk label is already in your custom list.')
      return
    }
    setManualSaving(true)
    try {
      const id = `man_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
      const nextChip: SuggestedRiskAiItem = { id, label, category: 'operational' }
      const mergedAssessment: AssessmentData = {
        ...mergeAssessmentData(job.assessment_data),
        ...(job.assessment_data ?? {}),
        manual_risk_chips: [...prev, nextChip],
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: mergedAssessment }),
      })
      const payload = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !payload.job) throw new Error(payload.error ?? 'Could not save custom risk')
      onJobUpdate(payload.job)
      setDraftLabel('')
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Could not save custom risk')
    } finally {
      setManualSaving(false)
    }
  }

  async function applyPruneOrphans() {
    if (orphanRisks.length === 0 || pruneSaving) return
    setPruneSaving(true)
    try {
      const mergedAssessment = pruneOrphanRisks(job.assessment_data)
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: mergedAssessment }),
      })
      const payload = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !payload.job) throw new Error(payload.error ?? 'Could not update risks')
      onJobUpdate(payload.job)
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Could not update risks')
    } finally {
      setPruneSaving(false)
    }
  }

  async function removeManualRisk(id: string) {
    setManualSaving(true)
    try {
      const prev = job.assessment_data?.manual_risk_chips ?? []
      const manual_risk_chips = prev.filter(i => i.id !== id)
      const presenting_risk_ids = (job.assessment_data?.presenting_risk_ids ?? []).filter(pid => pid !== id)
      const mergedAssessment: AssessmentData = {
        ...mergeAssessmentData(job.assessment_data),
        ...(job.assessment_data ?? {}),
        manual_risk_chips,
        presenting_risk_ids,
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: mergedAssessment }),
      })
      const payload = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !payload.job) throw new Error(payload.error ?? 'Could not remove custom risk')
      onJobUpdate(payload.job)
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Could not remove custom risk')
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
          Risk candidates
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

          {orphanRisks.length > 0 && (
            <div
              style={{
                fontSize: 13,
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid rgba(251, 191, 36, 0.45)',
                background: 'rgba(251, 191, 36, 0.08)',
                color: 'var(--text)',
              }}
            >
              <strong style={{ display: 'block', marginBottom: 6 }}>Orphan risks</strong>
              <span style={{ color: 'var(--text-muted)' }}>
                {orphanRisks.length} risk chip(s) are only linked to hazards that are no longer in Presenting. Remove them or restore those hazards on the Hazards tab.
              </span>
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  disabled={pruneSaving || moveSaving}
                  onClick={() => void applyPruneOrphans()}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '6px 12px',
                    borderRadius: 8,
                    background: 'var(--surface-2)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    cursor: pruneSaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {pruneSaving ? 'Applying…' : `Remove ${orphanRisks.length} orphaned risk(s)`}
                </button>
              </div>
            </div>
          )}

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 12, minHeight: 48 }}>
            <div>
              <Subheading>Identified (approved hazards + Presentation)</Subheading>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignContent: 'flex-start' }}>
                {identifiedItems.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    None yet. Promote hazards on the Hazards tab, then press Identify (grounded in Presentation).
                  </div>
                ) : identifiedSuggested.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    All identified chips moved to Presenting risks.
                  </div>
                ) : (
                  identifiedSuggested.map(item => (
                    <RiskBubble
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
              <Subheading>Suggested (Generate)</Subheading>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignContent: 'flex-start' }}>
                {generatedItems.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    None yet. Press Generate for broader risk themes (approved hazards + Presentation).
                  </div>
                ) : generatedSuggested.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    All suggested chips moved to Presenting risks.
                  </div>
                ) : (
                  generatedSuggested.map(item => (
                    <RiskBubble
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
                    onClick={() => void addManualRisk()}
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
                    Add your own risk label when AI suggestions are close but not quite right.
                  </div>
                ) : manualSuggested.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    All custom chips moved to Presenting risks. Remove from Presenting to edit list here.
                  </div>
                ) : (
                  manualSuggested.map(item => (
                    <div key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <RiskBubble
                        item={item}
                        prefix="+"
                        actionLabel="Add"
                        onClick={() => moveToPresenting(item.id)}
                        disabled={moveSaving || manualSaving}
                      />
                      <button
                        type="button"
                        title="Remove custom risk"
                        disabled={manualSaving || moveSaving}
                        onClick={() => void removeManualRisk(item.id)}
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
                Approve hazards first, then use Identify for evidence-tight risks or Generate for a wider brainstorm.
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 8,
              marginTop: 'auto',
              flexShrink: 0,
            }}
          >
            {!hasApprovedHazards && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', width: '100%', textAlign: 'right' }}>
                Promote at least one hazard on the Hazards tab before Identify or Generate.
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={busy || moveSaving || manualSaving || pruneSaving || !hasApprovedHazards}
              onClick={runIdentify}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: '10px 18px',
                borderRadius: 9,
                background: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                opacity: busy || moveSaving || manualSaving || pruneSaving || !hasApprovedHazards ? 0.75 : 1,
                cursor: busy || moveSaving || manualSaving || pruneSaving || !hasApprovedHazards ? 'not-allowed' : 'pointer',
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
              disabled={busy || moveSaving || manualSaving || pruneSaving || !hasApprovedHazards}
              onClick={runGenerate}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: '10px 18px',
                borderRadius: 9,
                background: 'var(--green)',
                color: '#fff',
                border: '1px solid rgba(34, 197, 94, 0.45)',
                opacity: busy || moveSaving || manualSaving || pruneSaving || !hasApprovedHazards ? 0.75 : 1,
                cursor: busy || moveSaving || manualSaving || pruneSaving || !hasApprovedHazards ? 'not-allowed' : 'pointer',
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
          Presenting risks
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
            <RiskBubble
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
