/*
 * Field job records. Pure rules: templates, dwell, photo flags, bonus gates.
 * Australia/Brisbane throughout. Money is integer cents.
 */

export const BRISBANE = 'Australia/Brisbane'
export const SITE_RADIUS_M = 200
export const PHOTO_TIME_SKEW_MS = 2 * 60 * 60 * 1000
export const CALLBACK_DAYS = 14

export const RECORD_JOB_TYPES = [
  'biohazard',
  'hoarding',
  'squalor',
  'meth_testing',
  'mould_testing',
] as const

export type RecordJobType = (typeof RECORD_JOB_TYPES)[number]

export const STEP_TYPES = ['photo', 'checklist', 'chemical', 'note', 'test_record'] as const
export type StepType = (typeof STEP_TYPES)[number]

export const JOB_TYPE_LABEL: Record<RecordJobType, string> = {
  biohazard: 'Biohazard',
  hoarding: 'Hoarding',
  squalor: 'Gross filth and squalor',
  meth_testing: 'Meth testing',
  mould_testing: 'Mould testing',
}

export interface RateCard {
  biohazard_cents: number
  meth_cents: number
  mould_cents: number
  hoarding_cents_per_m3: number
  squalor_cents_per_m2: number
}

export const DEFAULT_RATES: RateCard = {
  biohazard_cents: 10000,
  meth_cents: 10000,
  mould_cents: 10000,
  hoarding_cents_per_m3: 1000,
  squalor_cents_per_m2: 250,
}

export interface SeedStep {
  title: string
  instruction: string
  step_type: StepType
  required: boolean
  min_photos: number
  checklist_items: string[]
}

export const SEED_STEPS: Record<RecordJobType, SeedStep[]> = {
  biohazard: [
    { title: 'Before photos', instruction: 'Photograph the affected area before you start.', step_type: 'photo', required: true, min_photos: 3, checklist_items: [] },
    { title: 'Site safety', instruction: 'Tick each item before you open the chemical.', step_type: 'checklist', required: true, min_photos: 0, checklist_items: ['Suit and gloves on', 'Area isolated', 'Sharps checked'] },
    { title: 'Disinfect', instruction: 'Photograph the product label, then start the dwell timer.', step_type: 'chemical', required: true, min_photos: 1, checklist_items: [] },
    { title: 'After photos', instruction: 'Photograph the same area when the work is finished.', step_type: 'photo', required: true, min_photos: 3, checklist_items: [] },
    { title: 'Scope changes', instruction: 'Write anything that was different from the brief. Skip if nothing changed.', step_type: 'note', required: false, min_photos: 0, checklist_items: [] },
  ],
  hoarding: [
    { title: 'Before photos', instruction: 'Photograph the volume before anything is moved.', step_type: 'photo', required: true, min_photos: 2, checklist_items: [] },
    { title: 'Access and hazards', instruction: 'Note blocked exits, pests, or needles. Skip if none.', step_type: 'note', required: false, min_photos: 0, checklist_items: [] },
    { title: 'Cleared volume', instruction: 'Photograph the space after the quoted volume is out.', step_type: 'photo', required: true, min_photos: 2, checklist_items: [] },
    { title: 'Load-out', instruction: 'Tick when the load has left the property.', step_type: 'checklist', required: true, min_photos: 0, checklist_items: ['Volume matches the quote', 'Walkways clear', 'Waste secured'] },
  ],
  squalor: [
    { title: 'Before photos', instruction: 'Photograph the floors and surfaces before cleaning.', step_type: 'photo', required: true, min_photos: 2, checklist_items: [] },
    { title: 'Clean', instruction: 'Photograph the product label, then start the dwell timer.', step_type: 'chemical', required: true, min_photos: 1, checklist_items: [] },
    { title: 'After photos', instruction: 'Photograph the same surfaces when they are clean.', step_type: 'photo', required: true, min_photos: 2, checklist_items: [] },
  ],
  meth_testing: [
    { title: 'Sample locations', instruction: 'Photograph each place you will sample.', step_type: 'photo', required: true, min_photos: 1, checklist_items: [] },
    { title: 'Samples', instruction: 'Record the sample IDs and where each one was taken.', step_type: 'test_record', required: true, min_photos: 0, checklist_items: [] },
    { title: 'Observations', instruction: 'Note staining, odour, or rooms you could not enter. Skip if none.', step_type: 'note', required: false, min_photos: 0, checklist_items: [] },
  ],
  mould_testing: [
    { title: 'Affected areas', instruction: 'Photograph visible growth and the moisture meter in place.', step_type: 'photo', required: true, min_photos: 2, checklist_items: [] },
    { title: 'Readings', instruction: 'Record the moisture readings and the room for each one.', step_type: 'test_record', required: true, min_photos: 0, checklist_items: [] },
    { title: 'Notes', instruction: 'Note leaks or ventilation problems. Skip if none.', step_type: 'note', required: false, min_photos: 0, checklist_items: [] },
  ],
}

export const SEED_CHEMICALS: { name: string; dwell_minutes: number }[] = [
  { name: 'Hospital-grade disinfectant', dwell_minutes: 10 },
  { name: 'Hydrogen peroxide cleaner', dwell_minutes: 10 },
  { name: 'Mould treatment', dwell_minutes: 15 },
]

export function isRecordJobType(value: string): value is RecordJobType {
  return (RECORD_JOB_TYPES as readonly string[]).includes(value)
}

export function isStepType(value: string): value is StepType {
  return (STEP_TYPES as readonly string[]).includes(value)
}

export function brisbaneYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BRISBANE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function brisbaneStamp(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: BRISBANE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d + days))
  return utc.toISOString().slice(0, 10)
}

export function brisbaneWeekStart(date: Date): string {
  const ymd = brisbaneYmd(date)
  const [y, m, d] = ymd.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const delta = weekday === 0 ? 6 : weekday - 1
  return addDaysYmd(ymd, -delta)
}

export function brisbaneMonth(date: Date): string {
  return brisbaneYmd(date).slice(0, 7)
}

export function hoursBetween(onIso: string, offIso: string): number {
  const ms = new Date(offIso).getTime() - new Date(onIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 0
  return Math.round((ms / 3_600_000) * 100) / 100
}

export function haversineMetres(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const r = 6_371_000
  const toRad = (n: number) => (n * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function awayFromSite(
  lat: number | null,
  lng: number | null,
  siteLat: number | null,
  siteLng: number | null,
): boolean {
  if (lat == null || lng == null || siteLat == null || siteLng == null) return false
  return haversineMetres(lat, lng, siteLat, siteLng) > SITE_RADIUS_M
}

export function photoFlagReasons(input: {
  deviceTime: Date
  serverTime: Date
  lat: number | null
  lng: number | null
  siteLat: number | null
  siteLng: number | null
}): string[] {
  const reasons: string[] = []
  const skew = Math.abs(input.deviceTime.getTime() - input.serverTime.getTime())
  if (!Number.isFinite(skew) || skew > PHOTO_TIME_SKEW_MS) reasons.push('Device time is more than 2 hours from the server')
  if (awayFromSite(input.lat, input.lng, input.siteLat, input.siteLng)) {
    reasons.push('Photo is more than 200 m from the job address')
  }
  return reasons
}

export function isLikelyCameraFile(lastModified: number, now = Date.now()): boolean {
  const age = now - lastModified
  return age >= -60_000 && age < 2 * 60_000
}

export interface StepState {
  step_type: StepType
  required: boolean
  min_photos: number
  checklist_items: string[]
  ticks: boolean[]
  note_text: string
  test_text: string
  chemical_id: string | null
  dwell_minutes: number | null
  dwell_started_at: string | null
  photo_count: number
  completed_at: string | null
  title: string
}

export function dwellEndsAt(step: Pick<StepState, 'dwell_started_at' | 'dwell_minutes'>): number | null {
  if (!step.dwell_started_at || step.dwell_minutes == null) return null
  const start = new Date(step.dwell_started_at).getTime()
  if (!Number.isFinite(start)) return null
  return start + step.dwell_minutes * 60_000
}

export function stepIsComplete(step: StepState, now = Date.now()): boolean {
  if (step.completed_at && step.step_type !== 'chemical') return true
  if (step.step_type === 'photo') {
    const need = Math.max(step.min_photos, step.required ? 1 : 0)
    if (need === 0) return false
    return step.photo_count >= need
  }
  if (step.step_type === 'checklist') {
    if (step.checklist_items.length === 0) return !step.required || !!step.completed_at
    return step.checklist_items.every((_, i) => step.ticks[i] === true)
  }
  if (step.step_type === 'note') return step.note_text.trim().length > 0 || (!step.required && !!step.completed_at)
  if (step.step_type === 'test_record') return step.test_text.trim().length > 0 || (!step.required && !!step.completed_at)
  if (!step.chemical_id || step.photo_count < 1) return false
  const ends = dwellEndsAt(step)
  return ends != null && now >= ends
}

export function stepUnlocked(steps: StepState[], index: number, now = Date.now()): boolean {
  for (let i = 0; i < index; i++) {
    if (steps[i].required && !stepIsComplete(steps[i], now)) return false
  }
  return true
}

export function missingForClose(steps: StepState[], pendingUploads: number, now = Date.now()): string[] {
  const missing: string[] = []
  if (pendingUploads > 0) {
    missing.push(pendingUploads === 1 ? '1 photo still uploading' : `${pendingUploads} photos still uploading`)
  }
  steps.forEach((step, index) => {
    if (step.required && !stepIsComplete(step, now)) missing.push(step.title || `Step ${index + 1}`)
  })
  return missing
}

export function bonusCents(input: {
  jobType: RecordJobType
  quotedM3: number | null
  quotedM2: number | null
  rates: RateCard
  upliftPercent: number
  isLead: boolean
}): number {
  let base = 0
  if (input.jobType === 'biohazard') base = input.rates.biohazard_cents
  else if (input.jobType === 'meth_testing') base = input.rates.meth_cents
  else if (input.jobType === 'mould_testing') base = input.rates.mould_cents
  else if (input.jobType === 'hoarding') base = Math.round((input.quotedM3 ?? 0) * input.rates.hoarding_cents_per_m3)
  else base = Math.round((input.quotedM2 ?? 0) * input.rates.squalor_cents_per_m2)
  if (input.isLead && input.upliftPercent > 0) {
    base = Math.round(base * (1 + input.upliftPercent / 100))
  }
  return Math.max(0, base)
}

export type BonusStatus = 'pending' | 'earned' | 'not_earned'

export function bonusOutcome(input: {
  recordsComplete: boolean
  recordsMissing: string
  callbackRequired: boolean
  callbackReason: string | null
  closedAt: string | null
  bonusCents: number
  now?: Date
}): { status: BonusStatus; reason: string; cents: number } {
  if (!input.closedAt) return { status: 'pending', reason: 'Not closed out', cents: 0 }
  if (!input.recordsComplete) {
    return { status: 'not_earned', reason: input.recordsMissing || 'Records incomplete', cents: 0 }
  }
  if (input.callbackRequired) {
    return { status: 'not_earned', reason: input.callbackReason?.trim() || 'Callback required', cents: 0 }
  }
  const now = input.now ?? new Date()
  const opens = addDaysYmd(brisbaneYmd(new Date(input.closedAt)), CALLBACK_DAYS)
  if (brisbaneYmd(now) < opens) return { status: 'pending', reason: 'Inside the 14-day callback window', cents: input.bonusCents }
  return { status: 'earned', reason: '', cents: input.bonusCents }
}

export function callbackStillOpen(closedAt: string, now = new Date()): boolean {
  const opens = addDaysYmd(brisbaneYmd(new Date(closedAt)), CALLBACK_DAYS)
  return brisbaneYmd(now) < opens
}

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function needsQuote(jobType: RecordJobType): 'm3' | 'm2' | null {
  if (jobType === 'hoarding') return 'm3'
  if (jobType === 'squalor') return 'm2'
  return null
}
