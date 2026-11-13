import assert from 'node:assert/strict'
import test from 'node:test'
import { JOB_TYPES, URGENCIES } from '@/lib/agent/workspaceText'
import {
  intakeDuplicateView,
  intakeJobRow,
  intakeNotesLog,
  intakeProposal,
  normalizeIntake,
} from '@/lib/newJobIntake'
import {
  INTAKE_JOB_TYPES,
  INTAKE_URGENCIES,
  applySmartFillToDraft,
  emptyIntakeDraft,
  intakeDraftIsEmpty,
  parseIntakeDraft,
} from '@/lib/newJobIntakeDraft'
import { formatToTwilioE164 } from '@/lib/phone'
import { isNewJobCaptureHost, isNotesCaptureHost, isPhotoCaptureHost } from '@/lib/tradingNames'

/** libphonenumber-js loads without its metadata under tsx (see calls.test.ts). */
const phoneSkip = formatToTwilioE164('0412 345 678') ? false : 'phone metadata does not load under tsx'

function checked(body: Record<string, unknown>) {
  const result = normalizeIntake(body)
  if (!result.ok) assert.fail(result.error)
  return result
}

function refused(body: Record<string, unknown>): string {
  const result = normalizeIntake(body)
  if (result.ok) assert.fail('expected the form to be refused')
  return result.error
}

test('the form lists the same job types and urgencies the server accepts', () => {
  assert.deepEqual(INTAKE_JOB_TYPES.map(t => t.value), [...JOB_TYPES])
  assert.deepEqual(INTAKE_URGENCIES.map(u => u.value), [...URGENCIES])
})

test('a filled form becomes a trimmed job with E.164 phones', { skip: phoneSkip }, () => {
  const { job, callNotes } = checked({
    trading_name: 'forensic_cleaning_qld',
    client_name: '  Dave Smith ',
    client_contact_role: 'Property manager',
    client_organization_name: 'Acme Realty',
    client_phone: '0412 345 678',
    client_phones: [{ label: 'Work', number: '07 3000 1234' }, { label: 'Mobile', number: '  ' }, { label: 'Fax', number: '3345 1234' }],
    client_email: ' Dave@Acme.com.au ',
    site_address: '14 Smith St, Paddington QLD 4064',
    site_place_id: 'place-1',
    site_lat: -27.46,
    site_lng: 153.0,
    site_contact_name: 'Tenant Tina',
    site_contact_phone: '0400 111 222',
    job_type: 'unattended_death',
    urgency: 'urgent',
    access_notes: 'Key under mat',
    call_notes: ' Been about a week. ',
  })
  assert.equal(job.client_name, 'Dave Smith')
  assert.equal(job.client_phone, '+61412345678')
  assert.equal(job.client_email, 'dave@acme.com.au')
  assert.equal(job.trading_name, 'forensic_cleaning_qld')
  // Blank extra numbers are dropped, an unknown label becomes Mobile, and a number that
  // does not parse (no area code) is kept as typed rather than refused.
  assert.deepEqual(job.client_phones, [
    { label: 'Work', number: '+61730001234' },
    { label: 'Mobile', number: '3345 1234' },
  ])
  assert.equal(job.site_contact_phone, '+61400111222')
  assert.equal(job.site_place_id, 'place-1')
  assert.equal(job.site_lat, -27.46)
  assert.equal(job.job_type, 'unattended_death')
  assert.equal(job.urgency, 'urgent')
  assert.equal(callNotes, 'Been about a week.')
})

test('job type, urgency and trading name default when left alone', () => {
  const { job } = checked({ client_name: 'Dave' })
  assert.equal(job.job_type, 'other')
  assert.equal(job.urgency, 'standard')
  assert.equal(job.trading_name, null)
  assert.deepEqual(job.client_phones, [])
  assert.equal(job.client_phone, '')
})

test('a primary phone that is not a real number is refused', () => {
  assert.match(refused({ client_name: 'Dave', client_phone: '12345' }), /"12345" is not a valid phone number/)
})

test('a bad email, job type, urgency or trading name is refused in plain words', () => {
  assert.match(refused({ client_name: 'Dave', client_email: 'dave@' }), /not a valid email/)
  assert.match(refused({ client_name: 'Dave', job_type: 'asbestos' }), /job type/)
  assert.match(refused({ client_name: 'Dave', urgency: 'whenever' }), /Urgency/)
  assert.match(refused({ client_name: 'Dave', trading_name: 'acme' }), /trading name/)
})

test('a form with nobody to contact and nowhere to go is refused', () => {
  assert.match(refused({}), /at least/)
  assert.match(refused({ job_type: 'trauma', urgency: 'urgent', access_notes: 'Dog on site', call_notes: 'Rang twice' }), /at least/)
  assert.ok(normalizeIntake({ client_email: 'dave@acme.com.au' }).ok)
  assert.ok(normalizeIntake({ site_address: '14 Smith St' }).ok)
  assert.ok(normalizeIntake({ client_organization_name: 'Acme Realty' }).ok)
})

test('a phone number alone is enough to create a job', { skip: phoneSkip }, () => {
  assert.equal(checked({ client_phone: '0412 345 678' }).job.client_phone, '+61412345678')
})

test('coordinates are only kept as a pair, in range, with an address', () => {
  const base = { client_name: 'Dave', site_place_id: 'place-1' }
  const noAddress = checked({ ...base, site_lat: -27.4, site_lng: 153 }).job
  assert.equal(noAddress.site_place_id, '')
  assert.equal(noAddress.site_lat, null)
  assert.equal(noAddress.site_lng, null)
  const half = checked({ ...base, site_address: '14 Smith St', site_lat: -27.4 }).job
  assert.equal(half.site_lat, null)
  assert.equal(half.site_place_id, 'place-1')
  const outOfRange = checked({ ...base, site_address: '14 Smith St', site_lat: -127.4, site_lng: 153 }).job
  assert.equal(outOfRange.site_lat, null)
  assert.equal(outOfRange.site_lng, null)
  const text = checked({ ...base, site_address: '14 Smith St', site_lat: '-27.4', site_lng: '153' }).job
  assert.equal(text.site_lat, null)
})

test('the notes log opens with who made the job, then the call notes on one line', () => {
  const at = new Date('2026-11-12T02:30:00Z') // 12:30 pm in Brisbane
  const log = intakeNotesLog('Ben Mustonen', 'Been about a week.\n\nFamily are overseas. ', at)
  const lines = log.split('\n')
  assert.equal(lines.length, 2)
  assert.match(lines[0], /^\[12 Nov 2026, 12:30\s?pm\] Job created on the phone new-job form by Ben Mustonen\.$/i)
  assert.match(lines[1], /^\[12 Nov 2026, 12:30\s?pm\] Been about a week\. \/ Family are overseas\.$/i)
  assert.equal(intakeNotesLog('Ben', '   ', at).split('\n').length, 1)
  assert.match(intakeNotesLog('', '', at), /by staff\.$/)
})

test('the inserted row is a lead in the given organisation with the usual defaults', () => {
  const { job } = checked({ client_name: 'Dave', client_email: 'dave@acme.com.au', site_address: '14 Smith St' })
  const row = intakeJobRow(job, '4821', 'org-1', 'log')
  assert.equal(row.job_code, '4821')
  assert.equal(row.org_id, 'org-1')
  assert.equal(row.status, 'lead')
  assert.equal(row.notes, 'log')
  assert.equal(row.assessment_data, null)
  assert.equal(row.client_contact_relationship, '')
  assert.equal(row.insurance_claim_ref, '')
  assert.equal(row.client_email, 'dave@acme.com.au')
  assert.deepEqual(row.client_phones, [])
  assert.ok(!('call_notes' in row))
  assert.ok(!('allow_duplicates' in row))
})

test('the duplicate check gets the contact fields, and the phone is shown no client details', () => {
  const { job } = checked({ client_name: 'Dave Smith', client_email: 'dave@acme.com.au', site_address: '14 Smith St', urgency: 'urgent' })
  assert.deepEqual(intakeProposal(job), {
    client_name: 'Dave Smith',
    client_phone: '',
    client_email: 'dave@acme.com.au',
    site_address: '14 Smith St',
    job_description: '',
    urgency: 'urgent',
  })
  const view = intakeDuplicateView([
    { id: 'job-1', job_code: '1234', client_name: 'Dave Smith', site_address: '14 Smith St', status: 'lead', reasons: ['same phone'] },
  ])
  assert.deepEqual(view, [{ job_code: '1234', site_address: '14 Smith St', status: 'lead', reasons: ['same phone'] }])
})

test('a draft survives being stored and read back', () => {
  const draft = {
    ...emptyIntakeDraft(),
    trading_name: 'hoarding_cleaning_qld' as const,
    client_name: 'Dave',
    client_phones: [{ label: 'Work', number: '07 3000 1234' }],
    site_address: '14 Smith St',
    site_lat: -27.4,
    site_lng: 153,
    job_type: 'hoarding',
    urgency: 'emergency',
    call_notes: 'Line one\nLine two',
  }
  assert.deepEqual(parseIntakeDraft(JSON.stringify(draft)), draft)
})

test('a missing or malformed stored draft is a blank form', () => {
  const blank = emptyIntakeDraft()
  assert.deepEqual(parseIntakeDraft(null), blank)
  assert.deepEqual(parseIntakeDraft(''), blank)
  assert.deepEqual(parseIntakeDraft('{not json'), blank)
  assert.deepEqual(parseIntakeDraft('[1,2]'), blank)
  assert.deepEqual(parseIntakeDraft('"text"'), blank)
  assert.deepEqual(
    parseIntakeDraft(JSON.stringify({ client_name: 7, client_phones: 'x', job_type: 'asbestos', urgency: 3, trading_name: 'acme', site_lat: 'north' })),
    blank,
  )
  const partial = parseIntakeDraft(JSON.stringify({ client_name: 'Dave', client_phones: [null, { label: 'Fax', number: '1' }] }))
  assert.equal(partial.client_name, 'Dave')
  assert.deepEqual(partial.client_phones, [{ label: 'Mobile', number: '1' }])
  assert.equal(partial.job_type, 'other')
})

test('a draft is empty until something is typed or chosen', () => {
  assert.ok(intakeDraftIsEmpty(emptyIntakeDraft()))
  assert.ok(intakeDraftIsEmpty(parseIntakeDraft(null)))
  assert.ok(!intakeDraftIsEmpty({ ...emptyIntakeDraft(), client_name: 'D' }))
  assert.ok(!intakeDraftIsEmpty({ ...emptyIntakeDraft(), urgency: 'urgent' }))
  assert.ok(!intakeDraftIsEmpty({ ...emptyIntakeDraft(), client_phones: [{ label: 'Mobile', number: '' }] }))
  assert.ok(!intakeDraftIsEmpty({ ...emptyIntakeDraft(), trading_name: 'forensic_cleaning_qld' }))
})

test('Smart Fill fills what it found and leaves the rest of the form alone', () => {
  const typed = {
    ...emptyIntakeDraft(),
    client_name: 'Typed Name',
    client_contact_role: 'Tenant',
    site_address: 'Old address',
    site_place_id: 'place-1',
    site_lat: -27.4,
    site_lng: 153,
    access_notes: 'Key under mat',
  }
  const next = applySmartFillToDraft(typed, {
    client_name: 'Dave Smith',
    client_phone: '0412 345 678',
    client_email: '',
    site_address: '14 Smith St Paddington',
    job_type: 'unattended_death',
    urgency: 'urgent',
    company_name: 'Acme Realty',
  })
  assert.equal(next.client_name, 'Dave Smith')
  assert.equal(next.client_phone, '0412 345 678')
  assert.equal(next.client_organization_name, 'Acme Realty')
  assert.equal(next.client_contact_role, 'Tenant')
  assert.equal(next.access_notes, 'Key under mat')
  assert.equal(next.site_address, '14 Smith St Paddington')
  // The coordinates belonged to the old address.
  assert.equal(next.site_place_id, '')
  assert.equal(next.site_lat, null)
  assert.equal(next.site_lng, null)
  assert.equal(next.job_type, 'unattended_death')
  assert.equal(next.urgency, 'urgent')
  assert.equal(typed.client_name, 'Typed Name')
})

test('Smart Fill cannot set a job type or urgency the form does not offer, or move a picked address it did not find', () => {
  const picked = { ...emptyIntakeDraft(), site_address: '14 Smith St', site_place_id: 'place-1', site_lat: -27.4, site_lng: 153, job_type: 'trauma' }
  const next = applySmartFillToDraft(picked, { job_type: 'asbestos', urgency: 'whenever', site_address: '', client_name: 'Dave' })
  assert.equal(next.job_type, 'trauma')
  assert.equal(next.urgency, 'standard')
  assert.equal(next.site_place_id, 'place-1')
  assert.equal(next.site_lat, -27.4)
})

test('only newjob.biohazards.net is the new-job host', () => {
  assert.ok(isNewJobCaptureHost('newjob.biohazards.net'))
  assert.ok(isNewJobCaptureHost('NewJob.Biohazards.net:443'))
  assert.ok(!isNewJobCaptureHost('notes.biohazards.net'))
  assert.ok(!isNewJobCaptureHost('newjob.biohazards.net.evil.example'))
  assert.ok(!isNewJobCaptureHost('app.biohazards.net'))
  assert.ok(!isNewJobCaptureHost(null))
  assert.ok(!isNotesCaptureHost('newjob.biohazards.net'))
  assert.ok(!isPhotoCaptureHost('newjob.biohazards.net'))
})
