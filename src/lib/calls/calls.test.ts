import assert from 'node:assert/strict'
import test from 'node:test'
import { parseVoipPayload } from '@/lib/calls/payload'
import { tidyTranscript } from '@/lib/calls/clean'
import { RECORD_CALL_TOOL, extractionIssues, normalizeExtraction, stripMoney } from '@/lib/calls/extraction'
import { contactPatch, expandRooms, quoteDrafts } from '@/lib/calls/fileAgent'
import { formatToTwilioE164 } from '@/lib/phone'
import type { AssessmentData } from '@/lib/types'

/** libphonenumber-js loads without its metadata under tsx, so numbers cannot be checked there. */
const phoneSkip = formatToTwilioE164('0412 345 678') ? false : 'phone metadata does not load under tsx'

function headAgentOutput(patch: Record<string, unknown> = {}) {
  return {
    is_job_enquiry: true,
    summary: 'Son of the deceased called about his father\'s unit.',
    job_description: 'Unattended death in the main bedroom of a unit. The family wants the contents removed and the unit cleaned.',
    urgency: 'urgent',
    contact: { name: 'Mark Lee', organisation: '', role: '', relationship: 'son', phone: '0412 345 678', email: 'MARK@example.com' },
    site: { address: '4/12 King St, Annerley QLD 4103', contact_name: '', contact_phone: '', access_notes: 'Key in lockbox. Second floor, no lift.' },
    biohazard: {
      needed: true, reason: 'Decomposition in main bedroom', evidence: 'he was there about two weeks',
      cleaning_kind: 'unattended_death', biohazard_types: ['decomposition fluids'], areas_affected: ['main bedroom'],
      description: 'Decomposition fluids on carpet and bed.', rooms: [{ name: 'Main bedroom', preset: 'main_bedroom', count: 1 }],
      secondary_zone: 'hallway', secondary_contaminations: ['odour'], other_zones: ['kitchen'],
    },
    contents_clearance: {
      needed: true, reason: 'Family wants everything gone', evidence: 'we just want it all cleared out',
      clearance_kind: 'estate', estimated_m3: 18, volume_basis: 'about two skip bins',
    },
    surface_area: {
      needed: true, reason: 'Unit needs cleaning after clearance', evidence: 'the whole place is filthy',
      cleaning_kind: 'squalor', rooms: [{ name: 'Bedroom', preset: 'bedroom', count: 2 }, { name: 'Kitchen', preset: 'kitchen', count: 1, length_m: 5, width_m: 3 }],
      presentation: 'Rubbish and grime through the living areas. Budget is $3,000.', objective: 'Ready for sale.', scope_of_work: 'Clean all rooms.',
    },
    money_mentioned: '',
    unclear: [],
    ...patch,
  }
}

test('webhook fields are read from common names, nested data, and unix times', { skip: phoneSkip }, () => {
  const call = parseVoipPayload({
    event: 'recording.ready',
    data: { call_uuid: 'abc-1', from: '0412 345 678', to: '07 3123 4567', start_time: 1762300000, duration: '312', recording_url: 'https://rec.example/abc.mp3' },
  })
  assert.equal(call.provider_call_id, 'abc-1')
  assert.equal(call.caller_number, '+61412345678')
  assert.equal(call.called_number, '+61731234567')
  assert.equal(call.duration_s, 312)
  assert.equal(call.started_at, new Date(1762300000 * 1000).toISOString())
  assert.equal(call.recording_url, 'https://rec.example/abc.mp3')
})

test('a VoIPline recording event is read by its field names', () => {
  const call = parseVoipPayload({
    type: 'inbound_call_recording',
    unique_call_id: '1762310000.4821',
    user_name: 'MARK LEE',
    user_number: '61412345678',
    dest_number: '61731234567',
    call_start_at: '2026-11-05T09:12:00+10:00',
    recording: { listen: 'https://pbx.example/recordings/1762310000.4821.mp3?sig=abc' },
  })
  assert.equal(call.provider_call_id, '1762310000.4821')
  assert.equal(call.caller_number, '+61412345678')
  assert.equal(call.called_number, '+61731234567')
  assert.equal(call.started_at, '2026-11-04T23:12:00.000Z')
  assert.equal(call.recording_url, 'https://pbx.example/recordings/1762310000.4821.mp3?sig=abc')
})

test('transcript segments become speaker lines; a non-web recording reference is ignored', () => {
  const call = parseVoipPayload({
    CallSid: 'CA1',
    recording: 'recordings/abc.wav',
    transcript: [{ speaker: 'agent', text: 'Hello' }, { speaker: 'customer', text: 'Hi, my dad passed away' }],
  })
  assert.equal(call.recording_url, '')
  assert.equal(call.transcript, 'agent: Hello\ncustomer: Hi, my dad passed away')
})

test('tidy pass numbers speakers and drops repeated lines', () => {
  const tidy = tidyTranscript('SPEAKER_00:   hello there\nSPEAKER_00:   hello there\n\n[speaker_01] - hi   ')
  assert.equal(tidy, 'Speaker 1: hello there\nSpeaker 2: hi')
})

test('money is moved out of quote wording into money mentioned', () => {
  assert.deepEqual(stripMoney('Rooms are filthy. Budget is $3,000. Wants it done fast.'), {
    text: 'Rooms are filthy. Wants it done fast.',
    removed: ['Budget is $3,000.'],
  })
  const e = normalizeExtraction(headAgentOutput())
  assert.equal(e.quotes.surface_area?.presentation, 'Rubbish and grime through the living areas.')
  assert.match(e.money_mentioned, /\$3,000/)
})

test('normalisation falls back on unknown values and drops quotes not needed', () => {
  const e = normalizeExtraction(
    headAgentOutput({ urgency: 'asap', contents_clearance: { needed: false }, surface_area: { needed: true, cleaning_kind: 'deep', rooms: 'kitchen' } }),
  )
  assert.equal(e.urgency, 'standard')
  assert.equal(e.quotes.contents_clearance, null)
  assert.equal(e.quotes.surface_area?.cleaning_kind, 'surface')
  assert.deepEqual(e.quotes.surface_area?.rooms, [])
  assert.equal(e.contact.email, 'mark@example.com')
})

test('the head agent schema has nowhere to put a price', () => {
  const json = JSON.stringify(RECORD_CALL_TOOL.input_schema)
  const keys = [...json.matchAll(/"([a-z_0-9]+)":\{/g)].map(m => m[1])
  for (const key of keys) assert.doesNotMatch(key, /rate|fee|price|cost|total|amount/, key)
})

test('issues list what staff need to check', () => {
  const e = normalizeExtraction(headAgentOutput({ contact: { name: '' }, site: { address: '' }, contents_clearance: { needed: true, estimated_m3: null }, unclear: ['unit number'] }))
  const issues = extractionIssues(e, '')
  assert.ok(issues.includes('No caller name'))
  assert.ok(issues.includes('No site address'))
  assert.ok(issues.includes('No callback number'))
  assert.ok(issues.some(i => i.startsWith('Contents clearance volume')))
  assert.ok(issues.includes('Unclear: unit number'))
})

test('contact fields fill only what is empty; filled fields are reported, not overwritten', { skip: phoneSkip }, () => {
  const e = normalizeExtraction(headAgentOutput())
  const { patch, conflicts } = contactPatch(
    { client_name: 'Mark Lee', client_phone: '', site_address: '12 Other St', client_email: null },
    e,
    '+61400000000',
  )
  assert.equal(patch.client_name, undefined)
  assert.equal(patch.client_phone, '+61412345678')
  assert.equal(patch.client_email, 'mark@example.com')
  assert.equal(patch.client_contact_relationship, 'son')
  assert.equal(patch.access_notes, 'Key in lockbox. Second floor, no lift.')
  assert.equal(patch.site_address, undefined)
  assert.deepEqual(conflicts, [{ field: 'site_address', existing: '12 Other St', heard: '4/12 King St, Annerley QLD 4103' }])
})

test('the caller id is used when no callback number was said', () => {
  const e = normalizeExtraction(headAgentOutput({ contact: { name: 'Mark Lee', phone: '' } }))
  assert.equal(contactPatch({}, e, '+61400000000').patch.client_phone, '+61400000000')
})

test('rooms expand from presets and keep stated sizes', () => {
  const rooms = expandRooms([
    { name: 'Bedroom', preset: 'bedroom', count: 2, length_m: null, width_m: null, height_m: null },
    { name: 'Kitchen', preset: 'kitchen', count: 1, length_m: 5, width_m: 3, height_m: null },
  ])
  assert.deepEqual(rooms.map(r => [r.name, r.length_m, r.width_m, r.height_m, r.preset_id ?? null]), [
    ['Bedroom 1', 3.5, 3, 2.4, 'bedroom'],
    ['Bedroom 2', 3.5, 3, 2.4, 'bedroom'],
    ['Kitchen', 5, 3, 2.4, null],
  ])
})

test('one call drafts all three quotes with every price blank', () => {
  const e = normalizeExtraction(headAgentOutput())
  const { drafts, skipped, quotes_required } = quoteDrafts(null, e, 'call-1', '2026-11-05T10:00:00.000Z')
  assert.deepEqual(drafts.map(d => d.key), ['biohazard_cleaning_quote', 'contents_clearance_quote', 'surface_area_cleaning_quote'])
  assert.deepEqual(skipped, [])
  assert.equal(quotes_required.length, 3)
  for (const d of drafts) {
    for (const [k, v] of Object.entries(d.capture)) {
      if (/rate|fee|price/.test(k)) assert.equal(v, null, `${d.key}.${k}`)
    }
  }
  const ccq = drafts.find(d => d.key === 'contents_clearance_quote')!.capture
  assert.equal(ccq.estimated_m3, 18)
  assert.equal(ccq.clearance_kind, 'estate')
  const bcq = drafts.find(d => d.key === 'biohazard_cleaning_quote')!.capture
  assert.equal(bcq.cleaning_kind, 'unattended_death')
  assert.deepEqual(bcq.areas_affected, ['main bedroom'])
})

test('a quote already started on the job is not overwritten', () => {
  const e = normalizeExtraction(headAgentOutput())
  const ad = { contents_clearance_quote: { estimated_m3: 30 } } as unknown as AssessmentData
  const { drafts, skipped } = quoteDrafts(ad, e, 'call-1')
  assert.deepEqual(drafts.map(d => d.key), ['biohazard_cleaning_quote', 'surface_area_cleaning_quote'])
  assert.deepEqual(skipped.map(s => s.key), ['contents_clearance_quote'])
})
