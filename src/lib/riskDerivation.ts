/*
 * Derives a stable list of risk lines from Presentation (assessment_data + photos)
 * for the Risks HITL tab. IDs must stay stable for a given area index / key so
 * confirmations survive minor edits.
 */
import type { AssessmentData, DerivedRiskLine, Photo } from '@/lib/types'

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

export function mergeAssessmentData(saved: AssessmentData | null): AssessmentData {
  return { ...DEFAULT_ASSESSMENT, ...(saved ?? {}) }
}

const SPECIAL: { key: keyof AssessmentData['special_risks']; label: string }[] = [
  { key: 'sharps', label: 'Sharps or sharp objects' },
  { key: 'chemicals', label: 'Chemical hazards' },
  { key: 'structural_damage', label: 'Structural damage' },
  { key: 'infectious_disease', label: 'Infectious disease risk' },
  { key: 'vermin', label: 'Vermin' },
  { key: 'mold_spores', label: 'Mould spores' },
]

const PPE: { key: keyof AssessmentData['ppe_required']; label: string }[] = [
  { key: 'gloves', label: 'Gloves required' },
  { key: 'tyvek_suit', label: 'Tyvek suit required' },
  { key: 'respirator', label: 'Respirator required' },
  { key: 'face_shield', label: 'Face shield required' },
  { key: 'boot_covers', label: 'Boot covers required' },
  { key: 'double_bag', label: 'Double-bag disposal' },
]

export function derivePresentationRisks(data: AssessmentData, photos: Photo[]): DerivedRiskLine[] {
  const lines: DerivedRiskLine[] = []

  for (const { key, label } of SPECIAL) {
    if (data.special_risks?.[key]) {
      lines.push({
        id: `sr_${key}`,
        group: 'checklist',
        label,
        detail: 'Marked under Special risks on Presentation.',
      })
    }
  }

  for (const { key, label } of PPE) {
    if (data.ppe_required?.[key]) {
      lines.push({
        id: `ppe_${key}`,
        group: 'checklist',
        label,
        detail: 'Marked under PPE required on Presentation.',
      })
    }
  }

  const bio = (data.biohazard_type || '').trim()
  if (bio) {
    lines.push({
      id: 'site_biohazard',
      group: 'site',
      label: `Biohazard type: ${bio}`,
      detail: 'Recorded under Contamination on Presentation.',
    })
  }

  const access = (data.access_restrictions || '').trim()
  if (access) {
    lines.push({
      id: 'site_access',
      group: 'site',
      label: 'Access / entry restrictions noted',
      detail: access.length > 120 ? `${access.slice(0, 117)}…` : access,
    })
  }

  const obs = (data.observations || '').trim()
  if (obs.length > 20) {
    lines.push({
      id: 'notes_observations',
      group: 'evidence',
      label: 'Technician observations recorded',
      detail: 'Narrative risks may be described in this field — cross-check on Presentation.',
    })
  }

  const areas = data.areas ?? []
  areas.forEach((area, i) => {
    const name = (area.name || '').trim() || `Area ${i + 1}`
    const desc = (area.description || '').trim()
    if (desc.length > 0) {
      lines.push({
        id: `area_${i}_written`,
        group: 'areas',
        label: `Written description for ${name}`,
        detail: desc.length > 160 ? `${desc.slice(0, 157)}…` : desc,
      })
    }
  })

  const byAreaRef = new Map<string, Photo[]>()
  for (const p of photos) {
    const k = (p.area_ref || '').trim()
    if (!k) continue
    if (!byAreaRef.has(k)) byAreaRef.set(k, [])
    byAreaRef.get(k)!.push(p)
  }

  areas.forEach((area, i) => {
    const name = (area.name || '').trim()
    if (!name) return
    const list = byAreaRef.get(name) ?? []
    if (list.length === 0) return
    lines.push({
      id: `photo_area_${i}`,
      group: 'evidence',
      label: `Photographic evidence: ${name} (${list.length} photo${list.length === 1 ? '' : 's'})`,
      detail: 'Images uploaded under this area on Presentation — visual documentation of conditions.',
    })
  })

  return lines
}

export function mergeHitlWithDerived(
  derived: DerivedRiskLine[],
  saved: { id: string; confirmed: boolean | null; notes?: string }[] | undefined
): { id: string; label: string; detail: string; group: DerivedRiskLine['group']; confirmed: boolean | null; notes: string }[] {
  const map = new Map(saved?.map(s => [s.id, s]) ?? [])
  return derived.map(d => {
    const prev = map.get(d.id)
    return {
      id: d.id,
      label: d.label,
      detail: d.detail,
      group: d.group,
      confirmed: prev?.confirmed ?? null,
      notes: prev?.notes ?? '',
    }
  })
}
