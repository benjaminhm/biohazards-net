/**
 * Certified Occupational Hygienist lines shared by the biohazard quote and the surface cleaning quote.
 * Ticking one adds the same scope line, inclusion lines, and price line on either quote.
 */

export const BIOHAZARD_COH_LABEL = 'Certified Occupational Hygienist: site inspection and written method'
export const BIOHAZARD_ATP_LABEL = 'ATP verification testing'
export const BIOHAZARD_LAB_LABEL = 'Laboratory testing'

/** Added first in the scope of work when the COH is on the quote. */
export const BIOHAZARD_COH_SCOPE_LINE =
  'Before the works start, a Certified Occupational Hygienist (COH) inspects the site and issues written instructions for the method and the clearance. The works follow those instructions. Where this scope and the hygienist differ, the hygienist applies. Hold point: after removal, the COH inspects the exposed surfaces, including the subfloor, and confirms any further removal before cleaning starts.'

/** Added after the inclusions when the COH is on the quote. */
export const BIOHAZARD_COH_INCLUSION_LINES = [
  'A site inspection by a Certified Occupational Hygienist (COH) before the works start, written instructions for the method and the clearance, and the COH inspection at the hold point after removal.',
  'Clearance of the treated surfaces to the criteria set by the COH. Surfaces that fail are cleaned again and retested once. Further re-cleaning is a written variation.',
  'Records for the hygienist: photos before, during, and after the works, disinfectant product and batch numbers, waste disposal certificates, and test results.',
] as const

/** Added at the end, before the completion report, when only ATP testing is on the quote. */
export const BIOHAZARD_ATP_SCOPE_LINE =
  'Hold point, clearance: at the end of the works, verify the decontamination by ATP surface testing of the cleaned surfaces, at the sampling points and to the pass limits set by the Certified Occupational Hygienist, and record the results. Surfaces that fail are cleaned again and retested.'

/** Added at the end, before the completion report, when only laboratory testing is on the quote. */
export const BIOHAZARD_LAB_SCOPE_LINE =
  'Hold point, clearance: at the end of the works, take surface samples from the cleaned surfaces for laboratory testing, to the criteria set by the Certified Occupational Hygienist, and record the results. Surfaces that fail are cleaned again and retested.'

/** COH verification is both. Added at the end, before the completion report, when ATP testing and laboratory testing are on the quote. */
export const BIOHAZARD_VERIFICATION_SCOPE_LINE =
  'Hold point, clearance: at the end of the works, the Certified Occupational Hygienist verifies the decontamination by ATP surface testing and by laboratory testing of surface samples, at the sampling points and to the pass limits the hygienist sets, and records the results. Surfaces that fail are cleaned again and retested.'

export interface HygienistServices {
  /** Certified Occupational Hygienist inspects the site and issues written method and clearance. */
  coh_rap: boolean
  /** Ex GST. */
  coh_rap_fee: number | null
  /** ATP surface testing. One of the two parts of COH verification. */
  atp_testing: boolean
  atp_tests: number | null
  /** Ex GST, per test. */
  atp_rate: number | null
  /** Laboratory testing of surface samples. The other part of COH verification. */
  lab_testing: boolean
  lab_tests: number | null
  /** Ex GST, per test. */
  lab_rate: number | null
}

export interface HygienistQuoteLine {
  label: string
  quantity: number
  unit: string
  rate: number
  amount: number
  kind: 'coh' | 'atp' | 'lab'
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function quantityOrZero(value: number | null | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function emptyHygienistServices(): HygienistServices {
  return {
    coh_rap: false,
    coh_rap_fee: null,
    atp_testing: false,
    atp_tests: null,
    atp_rate: null,
    lab_testing: false,
    lab_tests: null,
    lab_rate: null,
  }
}

export function normalizeHygienistServices(raw: Record<string, unknown>, qty: (value: unknown) => number | null): HygienistServices {
  return {
    coh_rap: raw.coh_rap === true,
    coh_rap_fee: qty(raw.coh_rap_fee),
    atp_testing: raw.atp_testing === true,
    atp_tests: qty(raw.atp_tests),
    atp_rate: qty(raw.atp_rate),
    lab_testing: raw.lab_testing === true,
    lab_tests: qty(raw.lab_tests),
    lab_rate: qty(raw.lab_rate),
  }
}

/** Price lines for the ticked hygienist services. A tick with a blank amount is still a line, at zero. */
export function hygienistQuoteLines(input: HygienistServices): HygienistQuoteLine[] {
  const lines: HygienistQuoteLine[] = []
  if (input.coh_rap) {
    const fee = round2(quantityOrZero(input.coh_rap_fee))
    lines.push({ label: BIOHAZARD_COH_LABEL, quantity: 1, unit: 'plan', rate: fee, amount: fee, kind: 'coh' })
  }
  if (input.atp_testing) {
    const tests = Math.round(quantityOrZero(input.atp_tests))
    const rate = round2(quantityOrZero(input.atp_rate))
    lines.push({ label: BIOHAZARD_ATP_LABEL, quantity: tests, unit: tests === 1 ? 'test' : 'tests', rate, amount: round2(tests * rate), kind: 'atp' })
  }
  if (input.lab_testing) {
    const tests = Math.round(quantityOrZero(input.lab_tests))
    const rate = round2(quantityOrZero(input.lab_rate))
    lines.push({ label: BIOHAZARD_LAB_LABEL, quantity: tests, unit: tests === 1 ? 'test' : 'tests', rate, amount: round2(tests * rate), kind: 'lab' })
  }
  return lines
}

/**
 * The scope of work with the COH line first and the verification line at the end, before the completion report,
 * when they are on the quote. Verification is ATP testing and laboratory testing. A scope that already covers a part is left as it is.
 */
export function biohazardScopeWithServices(
  scope: string,
  capture: Pick<HygienistServices, 'coh_rap' | 'atp_testing' | 'lab_testing'>,
): string {
  const lines = scope.split('\n')
  if (capture.coh_rap && !/occupational hygien|written instructions/i.test(scope)) lines.unshift(BIOHAZARD_COH_SCOPE_LINE)
  const hasAtp = /\bATP\b/.test(scope)
  const hasLab = /laborator/i.test(scope)
  const verification: string[] = []
  if (capture.atp_testing && capture.lab_testing && !hasAtp && !hasLab) verification.push(BIOHAZARD_VERIFICATION_SCOPE_LINE)
  else {
    if (capture.atp_testing && !hasAtp) verification.push(BIOHAZARD_ATP_SCOPE_LINE)
    if (capture.lab_testing && !hasLab) verification.push(BIOHAZARD_LAB_SCOPE_LINE)
  }
  const report = lines.findIndex(line => /completion report|records of the works/i.test(line))
  lines.splice(report === -1 ? lines.length : report, 0, ...verification)
  return lines.join('\n')
}

/** The inclusions with the COH lines added when the COH is on the quote. Inclusions that already cover the COH are left as they are. */
export function biohazardInclusionsWithServices(
  inclusions: string,
  capture: Pick<HygienistServices, 'coh_rap'>,
): string {
  if (!capture.coh_rap || /occupational hygien|written instructions|\bCOH\b/i.test(inclusions)) return inclusions
  return [inclusions, ...BIOHAZARD_COH_INCLUSION_LINES].filter(Boolean).join('\n')
}
