import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AssessmentData } from '@/lib/types'
import { emptyHouseSurvey, houseSurveyDocument } from '@/lib/houseSurvey'
import {
  houseSurveyWithQuote,
  quoteSurveyLink,
  quotedVersusMeasured,
  surveyAreasFromQuoteRooms,
  surveyIsBlank,
} from '@/lib/surveyQuoteLink'
import { statementReferencePanel } from '@/lib/statementOfAccounts'

const sacq = {
  rate_per_m2: 12,
  exclude_ceiling: true,
  rooms: [
    { id: 'r1', name: 'Lounge', length_m: 5, width_m: 4, height_m: 2.4 },
    { id: 'r2', name: 'Kitchen', length_m: 3, width_m: 3, height_m: 2.4 },
  ],
}

test('a blank survey rate follows the quote and a typed rate stays', () => {
  const linked = houseSurveyWithQuote({ surface_area_cleaning_quote: sacq } as unknown as AssessmentData)
  assert.equal(linked.price_per_m2, 12)
  const typed = houseSurveyWithQuote({
    surface_area_cleaning_quote: sacq,
    house_survey: { areas: [], price_per_m2: 15 },
  } as unknown as AssessmentData)
  assert.equal(typed.price_per_m2, 15)
})

test('quoted rooms start the survey with the same priced area', () => {
  const link = quoteSurveyLink({ surface_area_cleaning_quote: sacq } as unknown as AssessmentData)
  assert.ok(link)
  assert.ok(surveyIsBlank(emptyHouseSurvey()))
  const areas = surveyAreasFromQuoteRooms(link)
  assert.deepEqual(areas.map(area => area.title), ['Lounge', 'Kitchen'])
  const doc = houseSurveyDocument('', '', { areas, price_per_m2: 12 })
  assert.equal(doc.areas[0].closed, true)
  assert.equal(doc.areas[0].priced, link.rooms[0].quoted_m2)
  assert.equal(doc.totals.priced, link.quoted_m2)
  assert.equal(surveyIsBlank({ areas, price_per_m2: null }), false)
})

test('labour and the call-out fee carry from the quote into the survey total', () => {
  const ad = {
    surface_area_cleaning_quote: { ...sacq, labour_days: 2, rate_per_labour_day: 500, mobilisation_fee: 150 },
  } as unknown as AssessmentData
  const link = quoteSurveyLink(ad)!
  const areas = surveyAreasFromQuoteRooms(link)
  const doc = houseSurveyDocument('', '', { areas, price_per_m2: 12 }, link)
  assert.equal(doc.charges?.labour_ex, 1000)
  assert.equal(doc.charges?.mobilisation_ex, 150)
  assert.equal(doc.job_total?.ex, Math.round((doc.totals.price_ex! + 1150) * 100) / 100)
  const typed = houseSurveyDocument('', '', { areas, price_per_m2: 12, labour_days: 3 }, link)
  assert.equal(typed.charges?.labour_ex, 1500)
  assert.equal(typed.charges?.from_quote.labour_days, false)
  const waived = quoteSurveyLink({
    surface_area_cleaning_quote: { ...sacq, mobilisation_fee: 150, mobilisation_waived: true, mobilisation_reason: 'Repeat client' },
  } as unknown as AssessmentData)
  const waivedDoc = houseSurveyDocument('', '', { areas, price_per_m2: 12 }, waived)
  assert.equal(waivedDoc.charges?.mobilisation_waived, true)
  assert.equal(waivedDoc.charges?.mobilisation_ex, 0)
  assert.equal(waivedDoc.totals.price_ex, doc.totals.price_ex)
})

test('quoted and measured line up by room, and the statement shows both', () => {
  const ad = { surface_area_cleaning_quote: sacq } as unknown as AssessmentData
  const link = quoteSurveyLink(ad)!
  const areas = surveyAreasFromQuoteRooms(link)
  areas[0].legs[0].length_m = 6
  areas[0].legs[2].length_m = 6
  const compare = quotedVersusMeasured({ areas, price_per_m2: null }, link)
  const lounge = compare.rows.find(row => row.label === 'Lounge')!
  assert.ok(lounge.measured_m2! > lounge.quoted_m2!)
  const panel = statementReferencePanel({ ...ad, house_survey: { areas, price_per_m2: null } } as unknown as AssessmentData, [])
  assert.equal(panel.survey.facts[0]?.label, 'Quoted (SACQ)')
  assert.match(panel.survey.facts[1]?.value ?? '', /\+/)
})
