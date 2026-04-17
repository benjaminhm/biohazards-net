/*
 * Assessment → Recommendations. HITL chip-workflow for promoting AI-identified
 * or generated next-step recommendations into "Presenting recommendations" —
 * these then feed Company Letter, reports, and invoice commentary. Autosaves
 * on every +/- move. Never auto-generates; identify/generate require a click.
 */
'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  AssessmentData,
  Job,
  RecommendationAudience,
  RecommendationItem,
} from '@/lib/types'
import { mergeAssessmentData } from '@/lib/riskDerivation'

const AUDIENCE_THEME: Record<
  RecommendationAudience,
  { bg: string; border: string; color: string; label: string }
> = {
  client:   { bg: 'rgba(96, 165, 250, 0.18)', border: 'rgba(96, 165, 250, 0.45)', color: '#93C5FD', label: 'Client' },
  insurer:  { bg: 'rgba(167, 139, 250, 0.18)', border: 'rgba(167, 139, 250, 0.45)', color: '#C4B5FD', label: 'Insurer' },
  occupant: { bg: 'rgba(52, 211, 153, 0.16)',  border: 'rgba(52, 211, 153, 0.4)',   color: '#6EE7B7', label: 'Occupant' },
  internal: { bg: 'rgba(251, 191, 36, 0.16)',  border: 'rgba(251, 191, 36, 0.4)',   color: '#FCD34D', label: 'Internal' },
}

const AUDIENCES: RecommendationAudience[] = ['client', 'insurer', 'occupant', 'internal']

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
}

function RecommendationBubble({
  item,
  prefix,
  actionLabel,
  onClick,
  disabled = false,
}: {
  item: RecommendationItem
  prefix: '+' | '-'
  actionLabel: string
  onClick: () => void
  disabled?: boolean
}) {
  const t = AUDIENCE_THEME[item.audience] ?? AUDIENCE_THEME.client
  const tip = item.rationale ? `${t.label} · ${item.rationale}` : t.label
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

export default function AssessmentRecommendationsTab({ job, onJobUpdate }: Props) {
  const [identifyLoading, setIdentifyLoading] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [identifyError, setIdentifyError] = useState('')
  const [generateError, setGenerateError] = useState('')
  const [presentingIds, setPresentingIds] = useState<string[]>([])
  const [moveSaving, setMoveSaving] = useState(false)
  const [draftLabel, setDraftLabel] = useState('')
  const [draftAudience, setDraftAudience] = useState<RecommendationAudience>('client')
  const [manualSaving, setManualSaving] = useState(false)

  const identifiedItems = useMemo(
    () => job.assessment_data?.identified_recommendations_ai?.items ?? [],
    [job.assessment_data?.identified_recommendations_ai?.items]
  )
  const generatedItems = useMemo(
    () => job.assessment_data?.suggested_recommendations_ai?.items ?? [],
    [job.assessment_data?.suggested_recommendations_ai?.items]
  )
  const manualItems = useMemo(
    () => job.assessment_data?.manual_recommendation_chips ?? [],
    [job.assessment_data?.manual_recommendation_chips]
  )

  const allById = useMemo(() => {
    const m = new Map<string, RecommendationItem>()
    for (const i of identifiedItems) m.set(i.id, i)
    for (const i of generatedItems) {
      if (!m.has(i.id)) m.set(i.id, i)
    }
    for (const i of manualItems) m.set(i.id, i)
    return m
  }, [identifiedItems, generatedItems, manualItems])

  const allItems = useMemo(() => [...allById.values()], [allById])

  useEffect(() => {
    const savedIds = job.assessment_data?.presenting_recommendation_ids ?? []
    const idSet = new Set(allItems.map(i => i.id))
    setPresentingIds(savedIds.filter(id => idSet.has(id)))
  }, [job.id, job.updated_at, job.assessment_data?.presenting_recommendation_ids, allItems])

  const identifiedSuggested = identifiedItems.filter(item => !presentingIds.includes(item.id))
  const generatedSuggested = generatedItems.filter(item => !presentingIds.includes(item.id))
  const manualSuggested = manualItems.filter(item => !presentingIds.includes(item.id))
  const presentingItems = presentingIds
    .map(id => allById.get(id))
    .filter(Boolean) as RecommendationItem[]

  const busy = identifyLoading || generateLoading

  async function persistPresentingIds(nextIds: string[], prevIds: string[]) {
    setPresentingIds(nextIds)
    setMoveSaving(true)
    try {
      const mergedAssessment: AssessmentData = {
        ...mergeAssessmentData(job.assessment_data),
        ...(job.assessment_data ?? {}),
        presenting_recommendation_ids: nextIds,
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: mergedAssessment }),
      })
      const payload = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !payload.job) throw new Error(payload.error ?? 'Could not save presenting recommendations')
      onJobUpdate(payload.job)
    } catch (e: unknown) {
      setPresentingIds(prevIds)
      window.alert(e instanceof Error ? e.message : 'Could not save presenting recommendations')
    } finally {
      setMoveSaving(false)
    }
  }

  function moveToPresenting(id: string) {
    if (moveSaving) return
    const prev = presentingIds
    if (prev.includes(id)) return
    void persistPresentingIds([...prev, id], prev)
  }

  function moveToSuggested(id: string) {
    if (moveSaving) return
    const prev = presentingIds
    void persistPresentingIds(prev.filter(x => x !== id), prev)
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
      const res = await fetch(`/api/jobs/${job.id}/suggest-recommendations`, {
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

  async function addManual() {
    const label = draftLabel.replace(/\s+/g, ' ').trim().slice(0, 140)
    if (!label) return
    const prev = job.assessment_data?.manual_recommendation_chips ?? []
    if (prev.some(i => i.label.toLowerCase() === label.toLowerCase())) {
      window.alert('That recommendation is already in your custom list.')
      return
    }
    setManualSaving(true)
    try {
      const id = `manrec_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
      const chip: RecommendationItem = { id, label, audience: draftAudience }
      const mergedAssessment: AssessmentData = {
        ...mergeAssessmentData(job.assessment_data),
        ...(job.assessment_data ?? {}),
        manual_recommendation_chips: [...prev, chip],
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: mergedAssessment }),
      })
      const payload = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !payload.job) throw new Error(payload.error ?? 'Could not save custom recommendation')
      onJobUpdate(payload.job)
      setDraftLabel('')
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Could not save custom recommendation')
    } finally {
      setManualSaving(false)
    }
  }

  async function removeManual(id: string) {
    setManualSaving(true)
    try {
      const prev = job.assessment_data?.manual_recommendation_chips ?? []
      const manual_recommendation_chips = prev.filter(i => i.id !== id)
      const presenting_recommendation_ids = (job.assessment_data?.presenting_recommendation_ids ?? []).filter(
        pid => pid !== id
      )
      const mergedAssessment: AssessmentData = {
        ...mergeAssessmentData(job.assessment_data),
        ...(job.assessment_data ?? {}),
        manual_recommendation_chips,
        presenting_recommendation_ids,
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: mergedAssessment }),
      })
      const payload = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !payload.job) throw new Error(payload.error ?? 'Could not remove custom recommendation')
      onJobUpdate(payload.job)
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Could not remove custom recommendation')
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
          Recommendation candidates
        </div>
        <div
          className="card"
          style={{
            padding: 16,
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
              <Subheading>Identified (from notes + Presentation)</Subheading>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignContent: 'flex-start' }}>
                {identifiedItems.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    None yet. Press Identify to extract recommendations already implied in progress notes, observations, and approved hazards.
                  </div>
                ) : identifiedSuggested.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    All identified chips moved to Presenting recommendations.
                  </div>
                ) : (
                  identifiedSuggested.map(item => (
                    <RecommendationBubble
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
                    None yet. Press Generate for broader next-step themes (paired follow-ups, verification steps, insurer scope clarifiers).
                  </div>
                ) : generatedSuggested.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    All suggested chips moved to Presenting recommendations.
                  </div>
                ) : (
                  generatedSuggested.map(item => (
                    <RecommendationBubble
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
                <textarea
                  value={draftLabel}
                  onChange={e => setDraftLabel(e.target.value)}
                  placeholder="Action-oriented recommendation (e.g. Replace affected plasterboard in ensuite)…"
                  maxLength={140}
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
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    Audience
                    <select
                      value={draftAudience}
                      onChange={e => setDraftAudience(e.target.value as RecommendationAudience)}
                      disabled={manualSaving || busy || moveSaving}
                      style={{
                        fontSize: 12,
                        padding: '6px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'var(--bg)',
                        color: 'var(--text)',
                      }}
                    >
                      {AUDIENCES.map(a => (
                        <option key={a} value={a}>{AUDIENCE_THEME[a].label}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={manualSaving || busy || moveSaving || !draftLabel.trim()}
                    onClick={() => void addManual()}
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
                    Add your own recommendation when AI wording is close but not quite right.
                  </div>
                ) : manualSuggested.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    All custom chips moved to Presenting recommendations. Remove from Presenting to edit list here.
                  </div>
                ) : (
                  manualSuggested.map(item => (
                    <div key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <RecommendationBubble
                        item={item}
                        prefix="+"
                        actionLabel="Add"
                        onClick={() => moveToPresenting(item.id)}
                        disabled={moveSaving || manualSaving}
                      />
                      <button
                        type="button"
                        title="Remove custom recommendation"
                        disabled={manualSaving || moveSaving}
                        onClick={() => void removeManual(item.id)}
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
                HITL-only: nothing is auto-extracted. Press Identify or Generate when you&apos;re ready.
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              marginTop: 'auto',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              disabled={busy || moveSaving || manualSaving}
              onClick={() => void runAi('identify')}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: '10px 18px',
                borderRadius: 9,
                background: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                opacity: busy || moveSaving || manualSaving ? 0.75 : 1,
                cursor: busy || moveSaving || manualSaving ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {identifyLoading ? (
                <>
                  <span
                    className="spinner"
                    style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,0.15)', borderTopColor: 'var(--accent)' }}
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
              onClick={() => void runAi('generate')}
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
          Presenting recommendations
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
          {presentingItems.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Promoted recommendations appear here and feed downstream docs (Company Letter, reports, invoice commentary).
            </div>
          ) : (
            presentingItems.map(item => (
              <RecommendationBubble
                key={item.id}
                item={item}
                prefix="-"
                actionLabel="Remove"
                onClick={() => moveToSuggested(item.id)}
                disabled={moveSaving || manualSaving}
              />
            ))
          )}
        </div>
      </section>
    </div>
  )
}
