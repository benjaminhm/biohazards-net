'use client'

import { useEffect, useState } from 'react'
import type {
  AssessmentData,
  Job,
  PreflightCheckItem,
  PreflightCriticalControlId,
  PreflightOperationalId,
  PreRemediationPreflightChecklist,
} from '@/lib/types'
import {
  createEmptyPreRemediationPreflightChecklist,
  PREFLIGHT_CRITICAL_IDS,
  PREFLIGHT_CRITICAL_LABELS,
  PREFLIGHT_OPERATIONAL_IDS,
  PREFLIGHT_OPERATIONAL_LABELS,
} from '@/lib/preRemediationPreflight'

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
}

const DEFAULT_ASSESSMENT: AssessmentData = {
  areas: [],
  contamination_level: 1,
  biohazard_type: '',
  ppe_required: {
    gloves: false,
    tyvek_suit: false,
    respirator: false,
    face_shield: false,
    boot_covers: false,
    double_bag: false,
  },
  special_risks: {
    sharps: false,
    chemicals: false,
    structural_damage: false,
    infectious_disease: false,
    vermin: false,
    mold_spores: false,
  },
  estimated_hours: 0,
  estimated_waste_litres: 0,
  access_restrictions: '',
  observations: '',
}

function mergeChecklist(job: Job): PreRemediationPreflightChecklist {
  const existing = job.assessment_data?.pre_remediation_preflight
  if (existing) return existing
  return createEmptyPreRemediationPreflightChecklist({
    job_id: job.id,
    site_address: job.site_address,
    client_contact: job.client_name,
  })
}

export default function PreRemediationChecklistTab({ job, onJobUpdate }: Props) {
  const [checklist, setChecklist] = useState<PreRemediationPreflightChecklist>(() => mergeChecklist(job))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setChecklist(mergeChecklist(job))
  }, [job])

  function setHeader<K extends keyof PreRemediationPreflightChecklist['header']>(
    key: K,
    value: PreRemediationPreflightChecklist['header'][K]
  ) {
    setChecklist(prev => ({ ...prev, header: { ...prev.header, [key]: value } }))
    setSaved(false)
  }

  function setOutcome<K extends keyof PreRemediationPreflightChecklist['outcome']>(
    key: K,
    value: PreRemediationPreflightChecklist['outcome'][K]
  ) {
    setChecklist(prev => ({ ...prev, outcome: { ...prev.outcome, [key]: value } }))
    setSaved(false)
  }

  function setCheckItem(
    section: 'critical' | 'operational',
    id: PreflightCriticalControlId | PreflightOperationalId,
    patch: Partial<PreflightCheckItem>
  ) {
    setChecklist(prev => {
      if (section === 'critical') {
        const cid = id as PreflightCriticalControlId
        return {
          ...prev,
          sections: {
            ...prev.sections,
            critical: {
              ...prev.sections.critical,
              [cid]: { ...prev.sections.critical[cid], ...patch },
            },
          },
        }
      }
      const oid = id as PreflightOperationalId
      return {
        ...prev,
        sections: {
          ...prev.sections,
          operational: {
            ...prev.sections.operational,
            [oid]: { ...prev.sections.operational[oid], ...patch },
          },
        },
      }
    })
    setSaved(false)
  }

  function toggleCriticalFailure(id: PreflightCriticalControlId, checked: boolean) {
    setChecklist(prev => {
      const next = checked
        ? Array.from(new Set([...prev.outcome.critical_failure_ids, id]))
        : prev.outcome.critical_failure_ids.filter(x => x !== id)
      return {
        ...prev,
        outcome: { ...prev.outcome, critical_failure_ids: next },
      }
    })
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const now = new Date().toISOString()
      const nextChecklist: PreRemediationPreflightChecklist = {
        ...checklist,
        updated_at: now,
      }
      const mergedAssessment: AssessmentData = {
        ...(job.assessment_data ?? DEFAULT_ASSESSMENT),
        pre_remediation_preflight: nextChecklist,
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: mergedAssessment }),
      })
      const payload = (await res.json()) as { job?: Job; error?: string }
      if (!res.ok || !payload.job) {
        throw new Error(payload.error ?? 'Failed to save checklist')
      }
      onJobUpdate(payload.job)
      setChecklist(nextChecklist)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err: unknown) {
      window.alert(err instanceof Error ? err.message : 'Failed to save checklist')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field">
          <label>Job ID</label>
          <input value={checklist.header.job_id} onChange={e => setHeader('job_id', e.target.value)} />
        </div>
        <div className="field">
          <label>Site Address</label>
          <input value={checklist.header.site_address} onChange={e => setHeader('site_address', e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Client / Contact</label>
            <input value={checklist.header.client_contact} onChange={e => setHeader('client_contact', e.target.value)} />
          </div>
          <div className="field">
            <label>Supervisor</label>
            <input value={checklist.header.supervisor_name} onChange={e => setHeader('supervisor_name', e.target.value)} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Preflight Date/Time (ISO)</label>
          <input
            value={checklist.header.preflight_datetime}
            onChange={e => setHeader('preflight_datetime', e.target.value)}
          />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Critical Controls</div>
        {PREFLIGHT_CRITICAL_IDS.map(id => {
          const item = checklist.sections.critical[id]
          return (
            <div key={id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={e => setCheckItem('critical', id, { checked: e.target.checked })}
                />
                <div style={{ fontSize: 14, fontWeight: 600 }}>{PREFLIGHT_CRITICAL_LABELS[id]}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                <input
                  value={item.notes ?? ''}
                  onChange={e => setCheckItem('critical', id, { notes: e.target.value })}
                  placeholder="Notes / evidence"
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={!!item.not_applicable}
                    onChange={e => setCheckItem('critical', id, { not_applicable: e.target.checked })}
                  />
                  N/A
                </label>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Operational Readiness</div>
        {PREFLIGHT_OPERATIONAL_IDS.map(id => {
          const item = checklist.sections.operational[id]
          return (
            <div key={id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={e => setCheckItem('operational', id, { checked: e.target.checked })}
                />
                <div style={{ fontSize: 14, fontWeight: 600 }}>{PREFLIGHT_OPERATIONAL_LABELS[id]}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                <input
                  value={item.notes ?? ''}
                  onChange={e => setCheckItem('operational', id, { notes: e.target.value })}
                  placeholder="Notes / dependencies"
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={!!item.not_applicable}
                    onChange={e => setCheckItem('operational', id, { not_applicable: e.target.checked })}
                  />
                  N/A
                </label>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Outcome</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, textTransform: 'none', letterSpacing: 0 }}>
            <input
              type="radio"
              name="preflight_result"
              checked={checklist.outcome.result === 'go'}
              onChange={() => setOutcome('result', 'go')}
            />
            GO
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, textTransform: 'none', letterSpacing: 0 }}>
            <input
              type="radio"
              name="preflight_result"
              checked={checklist.outcome.result === 'go_with_conditions'}
              onChange={() => setOutcome('result', 'go_with_conditions')}
            />
            GO WITH CONDITIONS
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, textTransform: 'none', letterSpacing: 0 }}>
            <input
              type="radio"
              name="preflight_result"
              checked={checklist.outcome.result === 'no_go'}
              onChange={() => setOutcome('result', 'no_go')}
            />
            NO-GO
          </label>
        </div>

        <div className="field">
          <label>Critical Failures (if any)</label>
          <div style={{ display: 'grid', gap: 6 }}>
            {PREFLIGHT_CRITICAL_IDS.map(id => (
              <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, textTransform: 'none', letterSpacing: 0 }}>
                <input
                  type="checkbox"
                  checked={checklist.outcome.critical_failure_ids.includes(id)}
                  onChange={e => toggleCriticalFailure(id, e.target.checked)}
                />
                {PREFLIGHT_CRITICAL_LABELS[id]}
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Conditions / Notes</label>
          <textarea
            rows={4}
            value={checklist.outcome.conditions_notes}
            onChange={e => setOutcome('conditions_notes', e.target.value)}
            style={{ resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Approved By</label>
            <input
              value={checklist.outcome.approved_by_name}
              onChange={e => setOutcome('approved_by_name', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Approved At (ISO)</label>
            <input
              value={checklist.outcome.approved_at ?? ''}
              onChange={e => setOutcome('approved_at', e.target.value || null)}
            />
          </div>
        </div>
      </div>

      <button
        className="btn btn-primary"
        onClick={save}
        disabled={saving}
        style={{ width: '100%', padding: 14, fontSize: 15 }}
      >
        {saving ? <><span className="spinner" /> Saving...</> : saved ? '✓ Saved' : 'Save Pre-Remediation Checklist'}
      </button>
    </div>
  )
}
