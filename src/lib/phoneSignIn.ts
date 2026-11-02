/*
 * Phone sign-in is an active org_users row linked to a person.
 * Technicians are created as role "member". Turning it off archives the row.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseStaffEmail } from '@/lib/staffLogin'

export function personClerkUserId(personId: string): string {
  return `person:${personId}`
}

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, ch => `\\${ch}`)
}

export interface PhoneSignInPerson {
  id: string
  name: string
  email: string | null
  phone_sign_in: boolean
  app_role: string | null
  photo_pin: string | null
  person_code: string
}

export function personShortCode(personId: string): string {
  return `U-${personId.replace(/-/g, '').slice(0, 6).toUpperCase()}`
}

type PersonRow = {
  id: string
  name: string
  email: string | null
  status: string | null
  org_id: string | null
  photo_pin?: string | null
}
type AccessRow = { id: string; person_id: string | null; role: string | null; is_active: boolean | null }

export type PhoneSignInResult =
  | { ok: true; person: PhoneSignInPerson }
  | { ok: false; error: string; status: number }

async function emailUsedBySomeoneElse(
  supabase: SupabaseClient,
  email: string,
  personId: string
): Promise<{ taken: boolean; error?: string }> {
  const { data, error } = await supabase
    .from('people')
    .select('id, email, status')
    .ilike('email', escapeIlike(email))
    .eq('status', 'active')
  if (error || !data) return { taken: false, error: error?.message ?? 'Could not check that email.' }
  const taken = data.some(row => row.id !== personId && normaliseStaffEmail(row.email) === email)
  return { taken }
}

function toListItem(person: PersonRow, access: AccessRow | undefined): PhoneSignInPerson {
  const active = !!access?.is_active
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    phone_sign_in: active,
    app_role: active ? (access?.role ?? null) : null,
    photo_pin: person.photo_pin ?? null,
    person_code: personShortCode(person.id),
  }
}

export async function listPhoneSignIn(
  supabase: SupabaseClient,
  orgId: string
): Promise<PhoneSignInPerson[]> {
  const { data: people, error } = await supabase
    .from('people')
    .select('id, name, email, status, org_id, photo_pin')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('name')
  if (error || !people) return []

  const { data: access } = await supabase
    .from('org_users')
    .select('id, person_id, role, is_active')
    .eq('org_id', orgId)
    .not('person_id', 'is', null)

  const byPerson = new Map<string, AccessRow>()
  for (const row of (access ?? []) as AccessRow[]) {
    if (!row.person_id) continue
    const current = byPerson.get(row.person_id)
    if (!current || (row.is_active && !current.is_active)) byPerson.set(row.person_id, row)
  }

  return (people as PersonRow[]).map(person => toListItem(person, byPerson.get(person.id)))
}

export async function setPhoneSignIn(
  supabase: SupabaseClient,
  orgId: string,
  personId: string,
  enabled: boolean
): Promise<PhoneSignInResult> {
  const { data: person, error: personError } = await supabase
    .from('people')
    .select('id, name, email, status, org_id, photo_pin')
    .eq('id', personId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (personError) return { ok: false, error: personError.message, status: 500 }
  if (!person) return { ok: false, error: 'That person was not found.', status: 404 }
  if (person.status !== 'active') return { ok: false, error: 'That person is not active.', status: 400 }

  const { data: rows, error: accessError } = await supabase
    .from('org_users')
    .select('id, person_id, role, is_active')
    .eq('org_id', orgId)
    .eq('person_id', personId)
  if (accessError) return { ok: false, error: accessError.message, status: 500 }
  const access = (rows ?? []) as AccessRow[]

  if (!enabled) {
    const privileged = access.some(row => row.role === 'admin' || row.role === 'owner' || row.role === 'manager' || row.role === 'team_lead')
    if (privileged) {
      return { ok: false, error: 'This person uses a desk login. Phone sign-in is for technicians.', status: 400 }
    }
    if (access.length > 0) {
      const { error } = await supabase
        .from('org_users')
        .update({ is_active: false })
        .eq('org_id', orgId)
        .eq('person_id', personId)
      if (error) return { ok: false, error: error.message, status: 500 }
    }
    return { ok: true, person: toListItem(person as PersonRow, undefined) }
  }

  const email = normaliseStaffEmail(person.email)
  if (!email) return { ok: false, error: 'Add an email address first.', status: 400 }
  const duplicate = await emailUsedBySomeoneElse(supabase, email, personId)
  if (duplicate.error) return { ok: false, error: duplicate.error, status: 500 }
  if (duplicate.taken) {
    return { ok: false, error: 'Another active person already uses that email.', status: 400 }
  }

  if (access.length === 0) {
    const { error } = await supabase.from('org_users').insert({
      org_id: orgId,
      clerk_user_id: personClerkUserId(personId),
      role: 'member',
      person_id: personId,
      is_active: true,
      capabilities: {},
    })
    if (error) return { ok: false, error: error.message, status: 500 }
    return {
      ok: true,
      person: toListItem(person as PersonRow, { id: '', person_id: personId, role: 'member', is_active: true }),
    }
  }

  const { error } = await supabase
    .from('org_users')
    .update({ is_active: true })
    .eq('org_id', orgId)
    .eq('person_id', personId)
  if (error) return { ok: false, error: error.message, status: 500 }

  const role = access.find(row => row.role === 'admin' || row.role === 'owner')?.role
    ?? access[0]?.role
    ?? 'member'
  return {
    ok: true,
    person: toListItem(person as PersonRow, { id: access[0].id, person_id: personId, role, is_active: true }),
  }
}

export async function archivePerson(
  supabase: SupabaseClient,
  orgId: string,
  personId: string,
): Promise<PhoneSignInResult> {
  const off = await setPhoneSignIn(supabase, orgId, personId, false)
  if (!off.ok) return off
  const { error } = await supabase
    .from('people')
    .update({ status: 'inactive' })
    .eq('id', personId)
    .eq('org_id', orgId)
  if (error) return { ok: false, error: error.message, status: 500 }
  return off.ok ? off : { ok: true, person: { id: personId, name: '', email: null, phone_sign_in: false, app_role: null, photo_pin: null, person_code: personShortCode(personId) } }
}

export async function setPersonPhotoPin(
  supabase: SupabaseClient,
  orgId: string,
  personId: string,
  rawPin: string | null,
): Promise<PhoneSignInResult> {
  const pin = (rawPin ?? '').trim()
  if (pin !== '' && !/^\d{4}$/.test(pin)) {
    return { ok: false, error: 'Photo PIN must be exactly 4 digits.', status: 400 }
  }
  const { data: person, error: personError } = await supabase
    .from('people')
    .select('id, name, email, status, org_id, photo_pin')
    .eq('id', personId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (personError) return { ok: false, error: personError.message, status: 500 }
  if (!person) return { ok: false, error: 'That person was not found.', status: 404 }

  if (pin) {
    const { data: existing } = await supabase
      .from('people')
      .select('id, name')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .eq('photo_pin', pin)
      .neq('id', personId)
      .maybeSingle()
    if (existing) {
      return { ok: false, error: `PIN ${pin} is already used by ${existing.name}.`, status: 400 }
    }
  }

  const nextPin = pin || null
  const { error: updateError } = await supabase
    .from('people')
    .update({ photo_pin: nextPin })
    .eq('id', personId)
    .eq('org_id', orgId)
  if (updateError) return { ok: false, error: updateError.message, status: 500 }

  const { data: rows } = await supabase
    .from('org_users')
    .select('id, person_id, role, is_active')
    .eq('org_id', orgId)
    .eq('person_id', personId)
  const access = ((rows ?? []) as AccessRow[]).find(r => r.is_active) ?? (rows?.[0] as AccessRow | undefined)
  return {
    ok: true,
    person: toListItem({ ...(person as PersonRow), photo_pin: nextPin }, access),
  }
}

export async function createTechnician(
  supabase: SupabaseClient,
  orgId: string,
  name: string,
  email: string
): Promise<PhoneSignInResult> {
  const trimmedName = name.trim()
  const normalised = normaliseStaffEmail(email)
  if (!trimmedName) return { ok: false, error: 'Enter a name.', status: 400 }
  if (!normalised || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
    return { ok: false, error: 'Enter a valid email address.', status: 400 }
  }
  const duplicate = await emailUsedBySomeoneElse(supabase, normalised, '')
  if (duplicate.error) return { ok: false, error: duplicate.error, status: 500 }
  if (duplicate.taken) {
    return { ok: false, error: 'Another active person already uses that email.', status: 400 }
  }

  const { data: person, error } = await supabase
    .from('people')
    .insert({
      org_id: orgId,
      name: trimmedName,
      email: normalised,
      role: 'employee',
      status: 'active',
    })
    .select('id, name, email, status, org_id')
    .single()
  if (error || !person) return { ok: false, error: error?.message ?? 'Could not add that person.', status: 500 }

  return setPhoneSignIn(supabase, orgId, person.id, true)
}
