'use client'

import { useState, useEffect } from 'react'
import type { Job, AssessmentData, Area } from '@/lib/types'

const DEFAULT_ASSESSMENT: AssessmentData = {
  areas: [],
  contamination_level: 1,
  biohazard_type: '',
  ppe_required: {
    gloves: false, tyvek_suit: false, respirator: false,
    face_shield: false, boot_covers: false, double_bag: false,
  },
  special_risks: {
    sharps: false, chemicals: false, structural_damage: false,
    infectious_disease: false, vermin: false, mold_spores: false,
  },
  estimated_hours: 0,
  estimated_waste_litres: 0,
  access_restrictions: '',
  observations: '',
  target_price: undefined,
}

interface Props {
  job: Job
  onJobUpdate: (job: Job) => void
}

function HazardLevel({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          style={{
            width: 32, height: 32, borderRadius: 6, fontSize: 13, fontWeight: 700,
            border: `2px solid ${value === n ? 'var(--accent)' : 'var(--border)'}`,
            background: value === n ? 'var(--accent)' : 'var(--surface-2)',
            color: value === n ? '#fff' : 'var(--text-muted)',
            transition: 'all 0.15s',
          }}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, textTransform: 'none', letterSpacing: 'normal', color: 'var(--text)', marginBottom: 8 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }}
      />
      {label}
    </label>
  )
}

function mergeWithDefaults(saved: AssessmentData | null): AssessmentData {
  return { ...DEFAULT_ASSESSMENT, ...(saved ?? {}) }
}

export default function AssessmentTab({ job, onJobUpdate }: Props) {
  const [data, setData] = useState<AssessmentData>(mergeWithDefaults(job.assessment_data))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setData(mergeWithDefaults(job.assessment_data))
  }, [job.id])

  function setField<K extends keyof AssessmentData>(key: K, value: AssessmentData[K]) {
    setData(d => ({ ...d, [key]: value }))
    setSaved(false)
  }

  function addArea() {
    setData(d => ({
      ...d,
      areas: [...d.areas, { name: '', sqm: 0, hazard_level: 1, description: '' }],
    }))
    setSaved(false)
  }

  function updateArea(index: number, field: keyof Area, value: string | number) {
    setData(d => {
      const areas = [...d.areas]
      areas[index] = { ...areas[index], [field]: value }
      return { ...d, areas }
    })
    setSaved(false)
  }

  function removeArea(index: number) {
    setData(d => ({ ...d, areas: d.areas.filter((_, i) => i !== index) }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: data, status: job.status === 'lead' ? 'assessed' : job.status }),
      })
      const resp = await res.json()
      onJobUpdate(resp.job)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const section = (title: string) => (
    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 12, marginTop: 28 }}>
      {title}
    </div>
  )

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Areas */}
      {section('Areas')}
      {data.areas.map((area, i) => (
        <div key={i} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px auto', gap: 10, marginBottom: 10, alignItems: 'end' }}>
            <div>
              <label>Area Name</label>
              <input value={area.name} onChange={e => updateArea(i, 'name', e.target.value)} placeholder="e.g. Master Bedroom" />
            </div>
            <div>
              <label>Sqm</label>
              <input type="number" value={area.sqm || ''} onChange={e => updateArea(i, 'sqm', parseFloat(e.target.value) || 0)} placeholder="0" min="0" />
            </div>
            <button
              onClick={() => removeArea(i)}
              style={{ padding: '10px 12px', color: '#F87171', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, background: 'rgba(239,68,68,0.08)', fontSize: 13 }}
            >
              Remove
            </button>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label>Hazard Level</label>
            <HazardLevel value={area.hazard_level} onChange={v => updateArea(i, 'hazard_level', v)} />
          </div>
          <div>
            <label>Description</label>
            <textarea value={area.description} onChange={e => updateArea(i, 'description', e.target.value)} placeholder="What was found here..." rows={2} style={{ resize: 'vertical' }} />
          </div>
        </div>
      ))}
      <button className="btn btn-secondary" onClick={addArea} style={{ fontSize: 13, marginBottom: 8 }}>
        + Add Area
      </button>

      {/* Contamination */}
      {section('Contamination')}
      <div className="field">
        <label>Contamination Level</label>
        <HazardLevel value={data.contamination_level} onChange={v => setField('contamination_level', v)} />
      </div>
      <div className="field">
        <label>Biohazard Type</label>
        <input value={data.biohazard_type} onChange={e => setField('biohazard_type', e.target.value)} placeholder="e.g. Blood, Decomposition, Sewage..." />
      </div>

      {/* PPE */}
      {section('PPE Required')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 20px' }}>
        <Checkbox label="Gloves" checked={data.ppe_required.gloves} onChange={v => setField('ppe_required', { ...data.ppe_required, gloves: v })} />
        <Checkbox label="Tyvek Suit" checked={data.ppe_required.tyvek_suit} onChange={v => setField('ppe_required', { ...data.ppe_required, tyvek_suit: v })} />
        <Checkbox label="Respirator" checked={data.ppe_required.respirator} onChange={v => setField('ppe_required', { ...data.ppe_required, respirator: v })} />
        <Checkbox label="Face Shield" checked={data.ppe_required.face_shield} onChange={v => setField('ppe_required', { ...data.ppe_required, face_shield: v })} />
        <Checkbox label="Boot Covers" checked={data.ppe_required.boot_covers} onChange={v => setField('ppe_required', { ...data.ppe_required, boot_covers: v })} />
        <Checkbox label="Double Bag" checked={data.ppe_required.double_bag} onChange={v => setField('ppe_required', { ...data.ppe_required, double_bag: v })} />
      </div>

      {/* Special Risks */}
      {section('Special Risks')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 20px' }}>
        <Checkbox label="Sharps" checked={data.special_risks.sharps} onChange={v => setField('special_risks', { ...data.special_risks, sharps: v })} />
        <Checkbox label="Chemicals" checked={data.special_risks.chemicals} onChange={v => setField('special_risks', { ...data.special_risks, chemicals: v })} />
        <Checkbox label="Structural Damage" checked={data.special_risks.structural_damage} onChange={v => setField('special_risks', { ...data.special_risks, structural_damage: v })} />
        <Checkbox label="Infectious Disease" checked={data.special_risks.infectious_disease} onChange={v => setField('special_risks', { ...data.special_risks, infectious_disease: v })} />
        <Checkbox label="Vermin" checked={data.special_risks.vermin} onChange={v => setField('special_risks', { ...data.special_risks, vermin: v })} />
        <Checkbox label="Mold Spores" checked={data.special_risks.mold_spores} onChange={v => setField('special_risks', { ...data.special_risks, mold_spores: v })} />
      </div>

      {/* Estimates */}
      {section('Estimates & Access')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
        <div className="field">
          <label>Estimated Hours</label>
          <input type="number" value={data.estimated_hours || ''} onChange={e => setField('estimated_hours', parseFloat(e.target.value) || 0)} placeholder="0" min="0" step="0.5" />
        </div>
        <div className="field">
          <label>Estimated Waste (Litres)</label>
          <input type="number" value={data.estimated_waste_litres || ''} onChange={e => setField('estimated_waste_litres', parseFloat(e.target.value) || 0)} placeholder="0" min="0" />
        </div>
      </div>
      {/* Target quote price */}
      {section('Quote Pricing')}
      <div className="field">
        <label>
          Target Quote Amount
          <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
            Claude works line items back from this
          </span>
        </label>
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-muted)', fontSize: 15, fontWeight: 600, pointerEvents: 'none',
          }}>$</span>
          <input
            type="number"
            value={data.target_price || ''}
            onChange={e => {
              const n = parseFloat(e.target.value)
              setField('target_price', isNaN(n) ? undefined : n)
            }}
            placeholder="e.g. 5500 (inc. GST) or 5000 (+GST)"
            min="0"
            step="50"
            style={{ paddingLeft: 24 }}
          />
        </div>
      </div>

      <div className="field">
        <label>Access Restrictions</label>
        <input value={data.access_restrictions} onChange={e => setField('access_restrictions', e.target.value)} placeholder="e.g. Key with property manager, code required..." />
      </div>

      {/* Observations */}
      {section('Technician Observations')}
      <div className="field">
        <textarea
          value={data.observations}
          onChange={e => setField('observations', e.target.value)}
          placeholder="Detailed notes from the site assessment — the more detail here, the better Claude's documents will be..."
          rows={6}
          style={{ resize: 'vertical' }}
        />
      </div>

      <button
        className="btn btn-primary"
        onClick={save}
        disabled={saving}
        style={{ width: '100%', padding: 14, fontSize: 15 }}
      >
        {saving ? <><span className="spinner" /> Saving...</> : saved ? '✓ Saved' : 'Save Assessment'}
      </button>
    </div>
  )
}
