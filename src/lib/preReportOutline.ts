/*
 * lib/preReportOutline.ts
 *
 * Heading numbers for the multi-part completion report, shared by the print
 * HTML and the PDF. Whole-job sections and each section printed from a part
 * are numbered 01, 02, … in print order; a part's sub-sections are 3.1, 3.2, …
 * over only those present. Only sections that print get a number.
 */
import type { PostRemediationEvaluationContent, PrePartResolved, PreRecordRow } from '@/lib/types'

export type PrePartSubKey = 'works' | 'methodology' | 'products' | 'waste' | 'outcome'

export const PRE_PART_SUBS: readonly { key: PrePartSubKey; title: string }[] = [
  { key: 'works', title: 'Works Undertaken' },
  { key: 'methodology', title: 'Methodology' },
  { key: 'products', title: 'Products & Equipment Used' },
  { key: 'waste', title: 'Waste Management & Disposal' },
  { key: 'outcome', title: 'Outcome & Verification' },
]

export interface PrePartOutline {
  n: string
  part: PrePartResolved
  subs: { key: PrePartSubKey; n: string; title: string }[]
}

export interface PartsReportOutline {
  executive_summary?: string
  site_conditions?: string
  parts: PrePartOutline[]
  recommendations?: string
  compliance?: string
  limitations?: string
}

const filled = (s?: string) => !!(s ?? '').trim()

/** Waste table rows: the CDR's figures first; a typed volume is dropped when the CDR gives one. */
export function prePartWasteRows(p: PrePartResolved): PreRecordRow[] {
  const fromRecord = p.waste_rows ?? []
  const w = p.waste
  const typed = ([['Waste type', w?.waste_type], ['Volume', w?.volume], ['Containment', w?.containment], ['Disposal', w?.disposal]] as const)
    .filter(([label, v]) => filled(v) && !(label === 'Volume' && fromRecord.length))
    .map(([label, v]) => ({ label, value: (v ?? '').trim() }))
  return [...fromRecord, ...typed]
}

export function prePartWorksRows(p: PrePartResolved) {
  return (p.works_rows ?? []).filter(r => filled(r.stage_name) || filled(r.description))
}

export function prePartProductsRows(p: PrePartResolved) {
  return (p.products_rows ?? []).filter(r => filled(r.item_name) || filled(r.usage_note))
}

export function partsReportOutline(c: PostRemediationEvaluationContent): PartsReportOutline {
  let n = 0
  const next = () => String(++n).padStart(2, '0')
  const out: PartsReportOutline = { parts: [] }
  if (filled(c.executive_summary)) out.executive_summary = next()
  if ((c.site_conditions ?? []).some(filled)) out.site_conditions = next()
  for (const part of c.parts ?? []) {
    const present: Record<PrePartSubKey, boolean> = {
      works: (part.measured_rows ?? []).length > 0 || prePartWorksRows(part).length > 0,
      methodology: filled(part.methodology),
      products: prePartProductsRows(part).length > 0,
      waste: prePartWasteRows(part).length > 0,
      outcome: filled(part.outcome_verification),
    }
    if (!Object.values(present).some(Boolean)) continue
    const num = next()
    let sub = 0
    out.parts.push({
      n: num,
      part,
      subs: PRE_PART_SUBS.filter(s => present[s.key]).map(s => ({ ...s, n: `${Number(num)}.${++sub}` })),
    })
  }
  if ((c.recommendations ?? []).some(filled)) out.recommendations = next()
  if (filled(c.compliance)) out.compliance = next()
  if (filled(c.limitations)) out.limitations = next()
  return out
}
