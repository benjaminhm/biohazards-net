/*
 * Database access for field job records. Callers have already checked the role.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { forwardGeocodeAddress } from '@/lib/geocode'
import {
  DEFAULT_RATES,
  JOB_TYPE_LABEL,
  RECORD_JOB_TYPES,
  SEED_CHEMICALS,
  SEED_STEPS,
  bonusCents,
  bonusOutcome,
  brisbaneMonth,
  brisbaneWeekStart,
  brisbaneYmd,
  callbackStillOpen,
  hoursBetween,
  isRecordJobType,
  isStepType,
  missingForClose,
  needsQuote,
  photoFlagReasons,
  stepIsComplete,
  stepUnlocked,
  type RateCard,
  type RecordJobType,
  type StepState,
  type StepType,
} from '@/lib/jobRecords'

export type StoreResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number }

function fail(error: string, status = 400): StoreResult<never> {
  return { ok: false, error, status }
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
}

function bools(value: unknown): boolean[] {
  if (!Array.isArray(value)) return []
  return value.map(item => item === true)
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

async function audit(
  supabase: SupabaseClient,
  orgId: string,
  actor: string,
  action: string,
  detail: Record<string, unknown>,
  jobId?: string | null,
) {
  await supabase.from('record_audit').insert({
    org_id: orgId,
    job_id: jobId ?? null,
    actor_user_id: actor,
    action,
    detail,
  })
}

export async function ensureDefaults(supabase: SupabaseClient, orgId: string) {
  const { count: stepCount } = await supabase
    .from('record_template_steps')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
  if (!stepCount) {
    const rows = RECORD_JOB_TYPES.flatMap(jobType =>
      SEED_STEPS[jobType].map((step, index) => ({
        org_id: orgId,
        job_type: jobType,
        position: index + 1,
        title: step.title,
        instruction: step.instruction,
        step_type: step.step_type,
        required: step.required,
        min_photos: step.min_photos,
        checklist_items: step.checklist_items,
      })),
    )
    await supabase.from('record_template_steps').insert(rows)
  }

  const { count: chemCount } = await supabase
    .from('record_chemicals')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
  if (!chemCount) {
    await supabase.from('record_chemicals').insert(SEED_CHEMICALS.map(row => ({ ...row, org_id: orgId })))
  }

  const { data: rates } = await supabase.from('record_rates').select('org_id').eq('org_id', orgId).maybeSingle()
  if (!rates) await supabase.from('record_rates').insert({ org_id: orgId, ...DEFAULT_RATES })
}

export async function listTemplates(supabase: SupabaseClient, orgId: string) {
  await ensureDefaults(supabase, orgId)
  const { data, error } = await supabase
    .from('record_template_steps')
    .select('*')
    .eq('org_id', orgId)
    .is('archived_at', null)
    .order('position')
  if (error) return fail(error.message, 500)
  return {
    ok: true as const,
    data: RECORD_JOB_TYPES.map(jobType => ({
      job_type: jobType,
      label: JOB_TYPE_LABEL[jobType],
      quote: needsQuote(jobType),
      steps: (data ?? []).filter(row => row.job_type === jobType),
    })),
  }
}

export async function createTemplateStep(
  supabase: SupabaseClient,
  orgId: string,
  input: {
    job_type: string
    title: string
    instruction: string
    step_type: string
    required: boolean
    min_photos: number
    checklist_items: string[]
  },
): Promise<StoreResult<{ id: string }>> {
  if (!isRecordJobType(input.job_type)) return fail('Choose a job type.')
  if (!isStepType(input.step_type)) return fail('Choose a step type.')
  const title = input.title.trim()
  if (!title) return fail('Enter a title.')
  const { data: last } = await supabase
    .from('record_template_steps')
    .select('position')
    .eq('org_id', orgId)
    .eq('job_type', input.job_type)
    .is('archived_at', null)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const position = (last?.position ?? 0) + 1
  const { data, error } = await supabase
    .from('record_template_steps')
    .insert({
      org_id: orgId,
      job_type: input.job_type,
      position,
      title,
      instruction: input.instruction.trim(),
      step_type: input.step_type,
      required: input.required,
      min_photos: input.step_type === 'photo' || input.step_type === 'chemical' ? Math.max(1, input.min_photos || 1) : 0,
      checklist_items: input.step_type === 'checklist' ? input.checklist_items : [],
    })
    .select('id')
    .single()
  if (error || !data) return fail(error?.message ?? 'Could not add that step.', 500)
  return { ok: true, data: { id: data.id } }
}

export async function updateTemplateStep(
  supabase: SupabaseClient,
  orgId: string,
  id: string,
  input: {
    title: string
    instruction: string
    step_type: string
    required: boolean
    min_photos: number
    checklist_items: string[]
  },
): Promise<StoreResult<{ id: string }>> {
  if (!isStepType(input.step_type)) return fail('Choose a step type.')
  const title = input.title.trim()
  if (!title) return fail('Enter a title.')
  const { error } = await supabase
    .from('record_template_steps')
    .update({
      title,
      instruction: input.instruction.trim(),
      step_type: input.step_type,
      required: input.required,
      min_photos: input.step_type === 'photo' || input.step_type === 'chemical' ? Math.max(1, input.min_photos || 1) : 0,
      checklist_items: input.step_type === 'checklist' ? input.checklist_items : [],
    })
    .eq('id', id)
    .eq('org_id', orgId)
    .is('archived_at', null)
  if (error) return fail(error.message, 500)
  return { ok: true, data: { id } }
}

export async function archiveTemplateStep(supabase: SupabaseClient, orgId: string, id: string) {
  const { error } = await supabase
    .from('record_template_steps')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', orgId)
  if (error) return fail(error.message, 500)
  return { ok: true as const, data: { id } }
}

export async function reorderTemplateSteps(
  supabase: SupabaseClient,
  orgId: string,
  jobType: string,
  ids: string[],
) {
  if (!isRecordJobType(jobType)) return fail('Choose a job type.')
  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase
      .from('record_template_steps')
      .update({ position: i + 1 })
      .eq('id', ids[i])
      .eq('org_id', orgId)
      .eq('job_type', jobType)
    if (error) return fail(error.message, 500)
  }
  return { ok: true as const, data: { ids } }
}

export async function listChemicals(supabase: SupabaseClient, orgId: string) {
  await ensureDefaults(supabase, orgId)
  const { data, error } = await supabase
    .from('record_chemicals')
    .select('id, name, dwell_minutes, archived_at')
    .eq('org_id', orgId)
    .is('archived_at', null)
    .order('name')
  if (error) return fail(error.message, 500)
  return { ok: true as const, data: data ?? [] }
}

export async function createChemical(
  supabase: SupabaseClient,
  orgId: string,
  name: string,
  dwellMinutes: number,
) {
  const trimmed = name.trim()
  if (!trimmed) return fail('Enter a name.')
  if (!Number.isInteger(dwellMinutes) || dwellMinutes < 0 || dwellMinutes > 24 * 60) {
    return fail('Enter a dwell time in minutes.')
  }
  const { data, error } = await supabase
    .from('record_chemicals')
    .insert({ org_id: orgId, name: trimmed, dwell_minutes: dwellMinutes })
    .select('id, name, dwell_minutes')
    .single()
  if (error || !data) return fail(error?.message ?? 'Could not add that chemical.', 500)
  return { ok: true as const, data }
}

export async function updateChemical(
  supabase: SupabaseClient,
  orgId: string,
  id: string,
  input: { name?: string; dwell_minutes?: number; archive?: boolean },
) {
  const patch: Record<string, unknown> = {}
  if (input.archive) patch.archived_at = new Date().toISOString()
  if (typeof input.name === 'string') {
    const trimmed = input.name.trim()
    if (!trimmed) return fail('Enter a name.')
    patch.name = trimmed
  }
  if (input.dwell_minutes != null) {
    if (!Number.isInteger(input.dwell_minutes) || input.dwell_minutes < 0) return fail('Enter a dwell time in minutes.')
    patch.dwell_minutes = input.dwell_minutes
  }
  const { error } = await supabase.from('record_chemicals').update(patch).eq('id', id).eq('org_id', orgId)
  if (error) return fail(error.message, 500)
  return { ok: true as const, data: { id } }
}

function rateCard(row: Record<string, unknown> | null): RateCard {
  return {
    biohazard_cents: num(row?.biohazard_cents) ?? DEFAULT_RATES.biohazard_cents,
    meth_cents: num(row?.meth_cents) ?? DEFAULT_RATES.meth_cents,
    mould_cents: num(row?.mould_cents) ?? DEFAULT_RATES.mould_cents,
    hoarding_cents_per_m3: num(row?.hoarding_cents_per_m3) ?? DEFAULT_RATES.hoarding_cents_per_m3,
    squalor_cents_per_m2: num(row?.squalor_cents_per_m2) ?? DEFAULT_RATES.squalor_cents_per_m2,
  }
}

export async function getRates(supabase: SupabaseClient, orgId: string) {
  await ensureDefaults(supabase, orgId)
  const { data, error } = await supabase.from('record_rates').select('*').eq('org_id', orgId).maybeSingle()
  if (error) return fail(error.message, 500)
  return { ok: true as const, data: rateCard(data) }
}

export async function saveRates(
  supabase: SupabaseClient,
  orgId: string,
  actor: string,
  rates: RateCard,
) {
  const current = await getRates(supabase, orgId)
  if (!current.ok) return current
  const { error } = await supabase.from('record_rates').upsert({ org_id: orgId, ...rates, updated_at: new Date().toISOString() })
  if (error) return fail(error.message, 500)
  await audit(supabase, orgId, actor, 'rates', { from: current.data, to: rates })
  return { ok: true as const, data: rates }
}

async function nextJobNumber(supabase: SupabaseClient, orgId: string) {
  const { data } = await supabase.from('record_jobs').select('job_number').eq('org_id', orgId)
  let max = 0
  for (const row of data ?? []) {
    const n = Number(String(row.job_number).replace(/\D/g, ''))
    if (Number.isFinite(n) && n > max) max = n
  }
  return `FCQ-${String(max + 1).padStart(4, '0')}`
}

export async function createRecordJob(
  supabase: SupabaseClient,
  orgId: string,
  actor: string,
  input: {
    address: string
    client_reference: string
    job_type: string
    quoted_m3: number | null
    quoted_m2: number | null
    assigned_person_id: string
    lead: boolean
    lead_uplift_percent: number
  },
) {
  await ensureDefaults(supabase, orgId)
  const address = input.address.trim()
  if (!address) return fail('Enter the address.')
  if (!isRecordJobType(input.job_type)) return fail('Choose a job type.')
  if (!input.assigned_person_id) return fail('Choose a technician.')
  const quote = needsQuote(input.job_type)
  if (quote === 'm3' && !(input.quoted_m3 != null && input.quoted_m3 > 0)) return fail('Enter the quoted volume in m³.')
  if (quote === 'm2' && !(input.quoted_m2 != null && input.quoted_m2 > 0)) return fail('Enter the quoted area in m².')
  const uplift = input.lead ? input.lead_uplift_percent : 0
  if (uplift < 0 || uplift > 100) return fail('Uplift must be between 0 and 100.')

  let siteLat: number | null = null
  let siteLng: number | null = null
  try {
    const geo = await forwardGeocodeAddress(address)
    if (geo) {
      siteLat = geo.lat
      siteLng = geo.lng
    }
  } catch {
    siteLat = null
    siteLng = null
  }

  const { data: template, error: templateError } = await supabase
    .from('record_template_steps')
    .select('*')
    .eq('org_id', orgId)
    .eq('job_type', input.job_type)
    .is('archived_at', null)
    .order('position')
  if (templateError) return fail(templateError.message, 500)
  if (!template?.length) return fail('This job type has no steps yet.')

  const jobNumber = await nextJobNumber(supabase, orgId)
  const { data: job, error } = await supabase
    .from('record_jobs')
    .insert({
      org_id: orgId,
      job_number: jobNumber,
      address,
      client_reference: input.client_reference.trim(),
      job_type: input.job_type,
      quoted_m3: quote === 'm3' ? input.quoted_m3 : null,
      quoted_m2: quote === 'm2' ? input.quoted_m2 : null,
      site_lat: siteLat,
      site_lng: siteLng,
      assigned_person_id: input.assigned_person_id,
      lead_person_id: input.lead ? input.assigned_person_id : null,
      lead_uplift_percent: uplift,
      created_by: actor,
    })
    .select('id, job_number')
    .single()
  if (error || !job) return fail(error?.message ?? 'Could not create the job.', 500)

  const steps = template.map((step, index) => ({
    org_id: orgId,
    job_id: job.id,
    position: index + 1,
    title: step.title,
    instruction: step.instruction,
    step_type: step.step_type,
    required: step.required,
    min_photos: step.min_photos,
    checklist_items: step.checklist_items ?? [],
    ticks: strings(step.checklist_items).map(() => false),
  }))
  const { error: stepError } = await supabase.from('record_job_steps').insert(steps)
  if (stepError) return fail(stepError.message, 500)
  await audit(supabase, orgId, actor, 'quoted_units', {
    job_number: job.job_number,
    quoted_m3: quote === 'm3' ? input.quoted_m3 : null,
    quoted_m2: quote === 'm2' ? input.quoted_m2 : null,
  }, job.id)
  return { ok: true as const, data: job }
}

async function peopleNames(supabase: SupabaseClient, orgId: string, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map<string, string>()
  const { data } = await supabase.from('people').select('id, name').eq('org_id', orgId).in('id', unique)
  return new Map((data ?? []).map(row => [row.id as string, row.name as string]))
}

export async function listRecordJobs(supabase: SupabaseClient, orgId: string, status: string | null) {
  let query = supabase
    .from('record_jobs')
    .select('id, job_number, address, client_reference, job_type, status, assigned_person_id, created_at, closed_at, callback_required')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  else query = query.neq('status', 'archived')
  const { data, error } = await query
  if (error) return fail(error.message, 500)
  const names = await peopleNames(supabase, orgId, (data ?? []).map(row => row.assigned_person_id))
  return {
    ok: true as const,
    data: (data ?? []).map(row => ({
      ...row,
      job_type_label: JOB_TYPE_LABEL[row.job_type as RecordJobType] ?? row.job_type,
      technician_name: names.get(row.assigned_person_id) ?? '',
    })),
  }
}

function toStepState(row: Record<string, unknown>, photoCount: number): StepState {
  const items = strings(row.checklist_items)
  const ticks = bools(row.ticks)
  return {
    step_type: row.step_type as StepType,
    required: row.required === true,
    min_photos: num(row.min_photos) ?? 0,
    checklist_items: items,
    ticks: items.map((_, i) => ticks[i] === true),
    note_text: typeof row.note_text === 'string' ? row.note_text : '',
    test_text: typeof row.test_text === 'string' ? row.test_text : '',
    chemical_id: (row.chemical_id as string | null) ?? null,
    dwell_minutes: num(row.dwell_minutes),
    dwell_started_at: (row.dwell_started_at as string | null) ?? null,
    photo_count: photoCount,
    completed_at: (row.completed_at as string | null) ?? null,
    title: typeof row.title === 'string' ? row.title : '',
  }
}

async function photoCounts(supabase: SupabaseClient, jobId: string) {
  const { data } = await supabase.from('record_photos').select('step_id').eq('job_id', jobId)
  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    const id = row.step_id as string
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

async function loadJob(supabase: SupabaseClient, orgId: string, jobId: string) {
  const { data: job, error } = await supabase
    .from('record_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) return fail(error.message, 500)
  if (!job) return fail('That job was not found.', 404)
  const { data: steps, error: stepError } = await supabase
    .from('record_job_steps')
    .select('*')
    .eq('job_id', jobId)
    .order('position')
  if (stepError) return fail(stepError.message, 500)
  const counts = await photoCounts(supabase, jobId)
  return { ok: true as const, data: { job, steps: steps ?? [], counts } }
}

async function signedPhotos(supabase: SupabaseClient, jobId: string) {
  const { data } = await supabase
    .from('record_photos')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at')
  const photos = []
  for (const row of data ?? []) {
    const { data: signed } = await supabase.storage.from('record-photos').createSignedUrl(row.storage_path, 60 * 60)
    photos.push({
      id: row.id,
      step_id: row.step_id,
      device_time: row.device_time,
      server_time: row.server_time,
      lat: row.lat,
      lng: row.lng,
      flagged: row.flagged,
      flag_reasons: row.flag_reasons,
      url: signed?.signedUrl ?? '',
    })
  }
  return photos
}

export async function getAdminRecord(supabase: SupabaseClient, orgId: string, jobId: string) {
  const loaded = await loadJob(supabase, orgId, jobId)
  if (!loaded.ok) return loaded
  const { job, steps, counts } = loaded.data
  const names = await peopleNames(supabase, orgId, [job.assigned_person_id, job.lead_person_id].filter(Boolean))
  const { data: notes } = await supabase.from('record_notes').select('*').eq('job_id', jobId).order('created_at')
  const { data: auditRows } = await supabase.from('record_audit').select('*').eq('job_id', jobId).order('created_at')
  const photos = await signedPhotos(supabase, jobId)
  const rates = await getRates(supabase, orgId)
  const card = rates.ok ? rates.data : DEFAULT_RATES
  const outcome = bonusOutcome({
    recordsComplete: job.records_complete,
    recordsMissing: job.records_missing,
    callbackRequired: job.callback_required,
    callbackReason: job.callback_reason,
    closedAt: job.closed_at,
    bonusCents: job.bonus_cents,
  })
  return {
    ok: true as const,
    data: {
      job: {
        ...job,
        job_type_label: JOB_TYPE_LABEL[job.job_type as RecordJobType] ?? job.job_type,
        technician_name: names.get(job.assigned_person_id) ?? '',
        lead_name: job.lead_person_id ? names.get(job.lead_person_id) ?? '' : '',
        bonus_status: outcome.status,
        bonus_reason: outcome.reason,
        bonus_display_cents: outcome.cents,
        callback_open: job.closed_at ? callbackStillOpen(job.closed_at) : false,
      },
      steps: steps.map(row => ({ ...row, photo_count: counts.get(row.id) ?? 0, state: toStepState(row, counts.get(row.id) ?? 0) })),
      notes: notes ?? [],
      photos,
      audit: auditRows ?? [],
      rates: card,
    },
  }
}

export async function patchRecordJob(
  supabase: SupabaseClient,
  orgId: string,
  actor: string,
  jobId: string,
  input: { quoted_m3?: number | null; quoted_m2?: number | null; archive?: boolean },
) {
  const loaded = await loadJob(supabase, orgId, jobId)
  if (!loaded.ok) return loaded
  const job = loaded.data.job
  if (input.archive) {
    const { error } = await supabase.from('record_jobs').update({ status: 'archived' }).eq('id', jobId).eq('org_id', orgId)
    if (error) return fail(error.message, 500)
    return { ok: true as const, data: { id: jobId } }
  }
  const patch: Record<string, unknown> = {}
  if (input.quoted_m3 !== undefined) patch.quoted_m3 = input.quoted_m3
  if (input.quoted_m2 !== undefined) patch.quoted_m2 = input.quoted_m2
  if (Object.keys(patch).length === 0) return { ok: true as const, data: { id: jobId } }
  const { error } = await supabase.from('record_jobs').update(patch).eq('id', jobId).eq('org_id', orgId)
  if (error) return fail(error.message, 500)
  await audit(supabase, orgId, actor, 'quoted_units', { from: { quoted_m3: job.quoted_m3, quoted_m2: job.quoted_m2 }, to: patch }, jobId)
  return { ok: true as const, data: { id: jobId } }
}

export async function markCallback(
  supabase: SupabaseClient,
  orgId: string,
  actor: string,
  jobId: string,
  reason: string,
) {
  const loaded = await loadJob(supabase, orgId, jobId)
  if (!loaded.ok) return loaded
  const job = loaded.data.job
  if (!job.closed_at) return fail('Close the job out before marking a callback.')
  if (!callbackStillOpen(job.closed_at)) return fail('The 14-day window has closed.')
  const trimmed = reason.trim()
  if (!trimmed) return fail('Enter a reason.')
  const { error } = await supabase
    .from('record_jobs')
    .update({
      callback_required: true,
      callback_reason: trimmed,
      callback_at: new Date().toISOString(),
      callback_by: actor,
    })
    .eq('id', jobId)
    .eq('org_id', orgId)
  if (error) return fail(error.message, 500)
  await audit(supabase, orgId, actor, 'callback', { reason: trimmed }, jobId)
  return { ok: true as const, data: { id: jobId } }
}

function visibleTo(job: { assigned_person_id: string | null; lead_person_id: string | null }, personId: string) {
  return job.assigned_person_id === personId || job.lead_person_id === personId
}

export async function listTechJobs(supabase: SupabaseClient, orgId: string, personId: string) {
  const { data, error } = await supabase
    .from('record_jobs')
    .select('id, job_number, address, job_type, status, created_at, closed_at, clock_on_at, assigned_person_id, lead_person_id')
    .eq('org_id', orgId)
    .neq('status', 'archived')
    .or(`assigned_person_id.eq.${personId},lead_person_id.eq.${personId}`)
    .order('created_at', { ascending: false })
  if (error) return fail(error.message, 500)
  const today = brisbaneYmd(new Date())
  const rows = (data ?? []).map(row => ({
    id: row.id,
    job_number: row.job_number,
    address: row.address,
    job_type: row.job_type,
    job_type_label: JOB_TYPE_LABEL[row.job_type as RecordJobType] ?? row.job_type,
    status: row.status,
    created_at: row.created_at,
    today: brisbaneYmd(new Date(row.created_at)) === today,
  }))
  rows.sort((a, b) => Number(b.today) - Number(a.today) || (a.status === 'closed' ? 1 : 0) - (b.status === 'closed' ? 1 : 0))
  return { ok: true as const, data: rows }
}

export async function getTechJob(supabase: SupabaseClient, orgId: string, personId: string, jobId: string) {
  const loaded = await loadJob(supabase, orgId, jobId)
  if (!loaded.ok) return loaded
  if (!visibleTo(loaded.data.job, personId)) return fail('That job was not found.', 404)
  const { job, steps, counts } = loaded.data
  const { data: notes } = await supabase.from('record_notes').select('id, body, created_at').eq('job_id', jobId).order('created_at')
  const { data: chemicals } = await supabase
    .from('record_chemicals')
    .select('id, name, dwell_minutes')
    .eq('org_id', orgId)
    .is('archived_at', null)
    .order('name')
  const photos = await signedPhotos(supabase, jobId)
  return {
    ok: true as const,
    data: {
      id: job.id,
      job_number: job.job_number,
      address: job.address,
      client_reference: job.client_reference,
      job_type: job.job_type,
      job_type_label: JOB_TYPE_LABEL[job.job_type as RecordJobType] ?? job.job_type,
      status: job.status,
      accepted_at: job.accepted_at,
      clock_on_at: job.clock_on_at,
      clock_off_at: job.clock_off_at,
      closed_at: job.closed_at,
      site_lat: job.site_lat,
      site_lng: job.site_lng,
      records_missing: job.records_missing,
      steps: steps.map(row => {
        const state = toStepState(row, counts.get(row.id) ?? 0)
        return { id: row.id, position: row.position, instruction: row.instruction ?? '', ...state, chemical_name: row.chemical_name ?? null }
      }),
      notes: notes ?? [],
      chemicals: chemicals ?? [],
      photos,
    },
  }
}

async function ownJob(supabase: SupabaseClient, orgId: string, personId: string, jobId: string) {
  const loaded = await loadJob(supabase, orgId, jobId)
  if (!loaded.ok) return loaded
  if (!visibleTo(loaded.data.job, personId)) return fail('That job was not found.', 404)
  return loaded
}

export async function acceptJob(supabase: SupabaseClient, orgId: string, personId: string, jobId: string) {
  const loaded = await ownJob(supabase, orgId, personId, jobId)
  if (!loaded.ok) return loaded
  if (loaded.data.job.status !== 'assigned') return fail('This job is already accepted.')
  const { error } = await supabase
    .from('record_jobs')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', jobId)
  if (error) return fail(error.message, 500)
  return { ok: true as const, data: { id: jobId } }
}

export async function clockOn(
  supabase: SupabaseClient,
  orgId: string,
  personId: string,
  jobId: string,
  lat: number | null,
  lng: number | null,
) {
  const loaded = await ownJob(supabase, orgId, personId, jobId)
  if (!loaded.ok) return loaded
  if (loaded.data.job.status !== 'accepted') return fail('Accept the job before you clock on.')
  const { error } = await supabase
    .from('record_jobs')
    .update({
      status: 'on_site',
      clock_on_at: new Date().toISOString(),
      clock_on_lat: lat,
      clock_on_lng: lng,
    })
    .eq('id', jobId)
  if (error) return fail(error.message, 500)
  return { ok: true as const, data: { id: jobId } }
}

export async function clockOff(
  supabase: SupabaseClient,
  orgId: string,
  personId: string,
  jobId: string,
  lat: number | null,
  lng: number | null,
) {
  const loaded = await ownJob(supabase, orgId, personId, jobId)
  if (!loaded.ok) return loaded
  if (!loaded.data.job.closed_at) return fail('Close the job out before you clock off.')
  if (loaded.data.job.clock_off_at) return fail('You are already clocked off.')
  const { error } = await supabase
    .from('record_jobs')
    .update({
      clock_off_at: new Date().toISOString(),
      clock_off_lat: lat,
      clock_off_lng: lng,
    })
    .eq('id', jobId)
  if (error) return fail(error.message, 500)
  return { ok: true as const, data: { id: jobId } }
}

export async function addNote(
  supabase: SupabaseClient,
  orgId: string,
  personId: string,
  jobId: string,
  body: string,
) {
  const loaded = await ownJob(supabase, orgId, personId, jobId)
  if (!loaded.ok) return loaded
  if (loaded.data.job.closed_at) return fail('This job is already closed out.')
  const trimmed = body.trim()
  if (!trimmed) return fail('Write a note.')
  const { error } = await supabase.from('record_notes').insert({
    org_id: orgId,
    job_id: jobId,
    person_id: personId,
    body: trimmed,
  })
  if (error) return fail(error.message, 500)
  return { ok: true as const, data: { id: jobId } }
}

export async function saveStep(
  supabase: SupabaseClient,
  orgId: string,
  personId: string,
  jobId: string,
  stepId: string,
  input: { note_text?: string; test_text?: string; ticks?: boolean[]; skip?: boolean },
) {
  const loaded = await ownJob(supabase, orgId, personId, jobId)
  if (!loaded.ok) return loaded
  if (loaded.data.job.closed_at) return fail('This job is already closed out.')
  if (!loaded.data.job.clock_on_at) return fail('Clock on before you start the steps.')
  const row = loaded.data.steps.find(item => item.id === stepId)
  if (!row) return fail('That step was not found.', 404)
  const state = toStepState(row, loaded.data.counts.get(stepId) ?? 0)
  const index = loaded.data.steps.findIndex(item => item.id === stepId)
  const states = loaded.data.steps.map(item => toStepState(item, loaded.data.counts.get(item.id) ?? 0))
  if (!stepUnlocked(states, index)) return fail('Finish the earlier step first.')
  if (input.skip) {
    if (state.required) return fail('This step is required.')
    const { error } = await supabase.from('record_job_steps').update({ completed_at: new Date().toISOString() }).eq('id', stepId)
    if (error) return fail(error.message, 500)
    return { ok: true as const, data: { id: stepId } }
  }
  const patch: Record<string, unknown> = {}
  if (state.step_type === 'note') patch.note_text = (input.note_text ?? '').trim()
  if (state.step_type === 'test_record') patch.test_text = (input.test_text ?? '').trim()
  if (state.step_type === 'checklist' && input.ticks) {
    if (input.ticks.length !== state.checklist_items.length) return fail('Tick every item.')
    patch.ticks = input.ticks
  }
  const next = toStepState({ ...row, ...patch }, loaded.data.counts.get(stepId) ?? 0)
  if (stepIsComplete(next)) patch.completed_at = new Date().toISOString()
  else if (state.required) return fail('This step is not finished yet.')
  const { error } = await supabase.from('record_job_steps').update(patch).eq('id', stepId)
  if (error) return fail(error.message, 500)
  return { ok: true as const, data: { id: stepId } }
}

export async function startDwell(
  supabase: SupabaseClient,
  orgId: string,
  personId: string,
  jobId: string,
  stepId: string,
  chemicalId: string,
) {
  const loaded = await ownJob(supabase, orgId, personId, jobId)
  if (!loaded.ok) return loaded
  if (loaded.data.job.closed_at) return fail('This job is already closed out.')
  const row = loaded.data.steps.find(item => item.id === stepId)
  if (!row || row.step_type !== 'chemical') return fail('That step does not use a chemical.')
  if ((loaded.data.counts.get(stepId) ?? 0) < 1) return fail('Photograph the product label first.')
  if (row.dwell_started_at) return fail('The timer has already started.')
  const { data: chemical, error: chemError } = await supabase
    .from('record_chemicals')
    .select('id, name, dwell_minutes')
    .eq('id', chemicalId)
    .eq('org_id', orgId)
    .is('archived_at', null)
    .maybeSingle()
  if (chemError || !chemical) return fail('Choose a chemical.')
  const { error } = await supabase
    .from('record_job_steps')
    .update({
      chemical_id: chemical.id,
      chemical_name: chemical.name,
      dwell_minutes: chemical.dwell_minutes,
      dwell_started_at: new Date().toISOString(),
    })
    .eq('id', stepId)
  if (error) return fail(error.message, 500)
  return { ok: true as const, data: { id: stepId, dwell_minutes: chemical.dwell_minutes } }
}

export async function closeJob(
  supabase: SupabaseClient,
  orgId: string,
  personId: string,
  jobId: string,
  pendingUploads: number,
) {
  const loaded = await ownJob(supabase, orgId, personId, jobId)
  if (!loaded.ok) return loaded
  const job = loaded.data.job
  if (!job.clock_on_at) return fail('Clock on before you close out.')
  if (job.closed_at) return fail('This job is already closed out.')
  const states = loaded.data.steps.map(row => toStepState(row, loaded.data.counts.get(row.id) ?? 0))
  const missing = missingForClose(states, pendingUploads)
  if (missing.length > 0) return fail(missing.join('\n'))
  const rates = await getRates(supabase, orgId)
  const card = rates.ok ? rates.data : DEFAULT_RATES
  const cents = bonusCents({
    jobType: job.job_type,
    quotedM3: num(job.quoted_m3),
    quotedM2: num(job.quoted_m2),
    rates: card,
    upliftPercent: num(job.lead_uplift_percent) ?? 0,
    isLead: !!job.lead_person_id && job.lead_person_id === job.assigned_person_id,
  })
  const { error } = await supabase
    .from('record_jobs')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      records_complete: true,
      records_missing: '',
      bonus_cents: cents,
    })
    .eq('id', jobId)
  if (error) return fail(error.message, 500)
  return { ok: true as const, data: { id: jobId } }
}

export async function saveComment(
  supabase: SupabaseClient,
  orgId: string,
  personId: string,
  jobId: string,
  body: string,
) {
  const loaded = await ownJob(supabase, orgId, personId, jobId)
  if (!loaded.ok) return loaded
  const outcome = bonusOutcome({
    recordsComplete: loaded.data.job.records_complete,
    recordsMissing: loaded.data.job.records_missing,
    callbackRequired: loaded.data.job.callback_required,
    callbackReason: loaded.data.job.callback_reason,
    closedAt: loaded.data.job.closed_at,
    bonusCents: loaded.data.job.bonus_cents,
  })
  if (outcome.status !== 'not_earned') return fail('You can comment when a job is marked not earned.')
  const trimmed = body.trim()
  if (!trimmed) return fail('Write a comment.')
  const { error } = await supabase.from('record_jobs').update({ technician_comment: trimmed }).eq('id', jobId)
  if (error) return fail(error.message, 500)
  return { ok: true as const, data: { id: jobId } }
}

export async function savePhoto(
  supabase: SupabaseClient,
  orgId: string,
  personId: string,
  input: {
    jobId: string
    stepId: string
    bytes: Buffer
    deviceTime: string
    lat: number | null
    lng: number | null
  },
) {
  const loaded = await ownJob(supabase, orgId, personId, input.jobId)
  if (!loaded.ok) return loaded
  if (loaded.data.job.closed_at) return fail('This job is already closed out.')
  const row = loaded.data.steps.find(item => item.id === input.stepId)
  if (!row) return fail('That step was not found.', 404)
  if (row.step_type !== 'photo' && row.step_type !== 'chemical') return fail('This step does not take a photo.')
  const device = new Date(input.deviceTime)
  if (Number.isNaN(device.getTime())) return fail('Missing the time the photo was taken.')
  const server = new Date()
  const reasons = photoFlagReasons({
    deviceTime: device,
    serverTime: server,
    lat: input.lat,
    lng: input.lng,
    siteLat: num(loaded.data.job.site_lat),
    siteLng: num(loaded.data.job.site_lng),
  })
  const photoId = crypto.randomUUID()
  const path = `${orgId}/${input.jobId}/${photoId}.jpg`
  const { error: uploadError } = await supabase.storage
    .from('record-photos')
    .upload(path, input.bytes, { contentType: 'image/jpeg', upsert: false })
  if (uploadError) return fail(uploadError.message, 500)
  const { error } = await supabase.from('record_photos').insert({
    id: photoId,
    org_id: orgId,
    job_id: input.jobId,
    step_id: input.stepId,
    storage_path: path,
    device_time: device.toISOString(),
    server_time: server.toISOString(),
    lat: input.lat,
    lng: input.lng,
    flagged: reasons.length > 0,
    flag_reasons: reasons.join('. '),
    created_by_person_id: personId,
  })
  if (error) return fail(error.message, 500)
  const count = (loaded.data.counts.get(input.stepId) ?? 0) + 1
  if (row.step_type === 'photo' && count >= Math.max(num(row.min_photos) ?? 1, 1)) {
    await supabase.from('record_job_steps').update({ completed_at: new Date().toISOString() }).eq('id', input.stepId)
  }
  return { ok: true as const, data: { id: photoId, flagged: reasons.length > 0, flag_reasons: reasons } }
}

export async function timesheetFor(supabase: SupabaseClient, orgId: string, personId: string, weekStart: string) {
  const weekEnd = brisbaneYmd(new Date(`${addDays(weekStart, 7)}T00:00:00+10:00`))
  const { data, error } = await supabase
    .from('record_jobs')
    .select('id, job_number, address, clock_on_at, clock_off_at, assigned_person_id, lead_person_id')
    .eq('org_id', orgId)
    .or(`assigned_person_id.eq.${personId},lead_person_id.eq.${personId}`)
    .not('clock_on_at', 'is', null)
  if (error) return fail(error.message, 500)
  const rows = (data ?? [])
    .filter(row => row.clock_on_at && brisbaneYmd(new Date(row.clock_on_at)) >= weekStart && brisbaneYmd(new Date(row.clock_on_at)) < weekEnd)
    .map(row => ({
      id: row.id,
      job_number: row.job_number,
      address: row.address,
      clock_on_at: row.clock_on_at,
      clock_off_at: row.clock_off_at,
      hours: row.clock_off_at ? hoursBetween(row.clock_on_at, row.clock_off_at) : null,
    }))
  const total = Math.round(rows.reduce((sum, row) => sum + (row.hours ?? 0), 0) * 100) / 100
  return { ok: true as const, data: { week_start: weekStart, rows, total_hours: total } }
}

function addDays(ymd: string, days: number) {
  const [y, m, d] = ymd.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d + days))
  return utc.toISOString().slice(0, 10)
}

export async function bonusesFor(supabase: SupabaseClient, orgId: string, personId: string, month: string) {
  const { data, error } = await supabase
    .from('record_jobs')
    .select('id, job_number, address, job_type, closed_at, records_complete, records_missing, callback_required, callback_reason, bonus_cents, technician_comment, assigned_person_id, lead_person_id')
    .eq('org_id', orgId)
    .not('closed_at', 'is', null)
    .or(`assigned_person_id.eq.${personId},lead_person_id.eq.${personId}`)
  if (error) return fail(error.message, 500)
  const rows = (data ?? [])
    .filter(row => row.closed_at && brisbaneMonth(new Date(row.closed_at)) === month)
    .map(row => {
      const outcome = bonusOutcome({
        recordsComplete: row.records_complete,
        recordsMissing: row.records_missing,
        callbackRequired: row.callback_required,
        callbackReason: row.callback_reason,
        closedAt: row.closed_at,
        bonusCents: row.bonus_cents,
      })
      return {
        id: row.id,
        job_number: row.job_number,
        address: row.address,
        job_type_label: JOB_TYPE_LABEL[row.job_type as RecordJobType] ?? row.job_type,
        closed_at: row.closed_at,
        status: outcome.status,
        reason: outcome.reason,
        cents: outcome.cents,
        technician_comment: row.technician_comment,
      }
    })
  const total = rows.reduce((sum, row) => sum + (row.status === 'not_earned' ? 0 : row.cents), 0)
  return { ok: true as const, data: { month, rows, total_cents: total } }
}

function csvEscape(value: unknown) {
  const text = value == null ? '' : String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export async function exportTimesheets(supabase: SupabaseClient, orgId: string, weekStart: string) {
  const { data: people } = await supabase.from('people').select('id, name').eq('org_id', orgId)
  const names = new Map((people ?? []).map(row => [row.id as string, row.name as string]))
  const { data, error } = await supabase
    .from('record_jobs')
    .select('job_number, address, clock_on_at, clock_off_at, assigned_person_id')
    .eq('org_id', orgId)
    .not('clock_on_at', 'is', null)
  if (error) return fail(error.message, 500)
  const weekEnd = addDays(weekStart, 7)
  const lines = [['Technician', 'Job', 'Address', 'Clock on', 'Clock off', 'Hours']]
  for (const row of data ?? []) {
    if (!row.clock_on_at) continue
    const day = brisbaneYmd(new Date(row.clock_on_at))
    if (day < weekStart || day >= weekEnd) continue
    lines.push([
      names.get(row.assigned_person_id) ?? '',
      row.job_number,
      row.address,
      row.clock_on_at,
      row.clock_off_at ?? '',
      row.clock_off_at ? String(hoursBetween(row.clock_on_at, row.clock_off_at)) : '',
    ])
  }
  return { ok: true as const, data: lines.map(line => line.map(csvEscape).join(',')).join('\n') }
}

export async function exportBonuses(supabase: SupabaseClient, orgId: string, month: string) {
  const { data: people } = await supabase.from('people').select('id, name').eq('org_id', orgId)
  const names = new Map((people ?? []).map(row => [row.id as string, row.name as string]))
  const { data, error } = await supabase
    .from('record_jobs')
    .select('job_number, assigned_person_id, closed_at, records_complete, records_missing, callback_required, callback_reason, bonus_cents, technician_comment')
    .eq('org_id', orgId)
    .not('closed_at', 'is', null)
  if (error) return fail(error.message, 500)
  const lines = [['Technician', 'Job', 'Month', 'Status', 'Reason', 'Bonus', 'Technician comment']]
  for (const row of data ?? []) {
    if (!row.closed_at || brisbaneMonth(new Date(row.closed_at)) !== month) continue
    const outcome = bonusOutcome({
      recordsComplete: row.records_complete,
      recordsMissing: row.records_missing,
      callbackRequired: row.callback_required,
      callbackReason: row.callback_reason,
      closedAt: row.closed_at,
      bonusCents: row.bonus_cents,
    })
    lines.push([
      names.get(row.assigned_person_id) ?? '',
      row.job_number,
      month,
      outcome.status,
      outcome.reason,
      (outcome.cents / 100).toFixed(2),
      row.technician_comment ?? '',
    ])
  }
  return { ok: true as const, data: lines.map(line => line.map(csvEscape).join(',')).join('\n') }
}
