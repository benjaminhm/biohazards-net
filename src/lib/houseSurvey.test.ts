import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Area } from '@/lib/types'
import {
  houseSurveyDocument,
  rectangleRoomsFromAreas,
  rectangleSize,
  rectangularSurveyLegs,
  surveyAreasFromRectangles,
} from '@/lib/houseSurvey'

test('length × width × height builds a closed four-wall room', () => {
  const areas = surveyAreasFromRectangles([{ name: 'Bedroom', length_m: 4, width_m: 3, height_m: 2.4 }])
  const doc = houseSurveyDocument('', '', { areas, price_per_m2: 10 })
  const room = doc.areas[0]
  assert.equal(room.title, 'Bedroom')
  assert.equal(room.closed, true)
  assert.equal(room.floor, 12)
  assert.equal(room.ceiling, 12)
  assert.equal(room.walls, 33.6)
  assert.equal(room.all, 57.6)
  assert.deepEqual(rectangleSize(areas[0].legs), { length_m: 4, width_m: 3 })
})

test('updating the box keeps wall ids, and an edited wall is no longer a box', () => {
  const legs = rectangularSurveyLegs(4, 3)
  const resized = rectangularSurveyLegs(5, 3, legs)
  assert.deepEqual(resized.map(leg => leg.id), legs.map(leg => leg.id))
  assert.deepEqual(rectangleSize(resized), { length_m: 5, width_m: 3 })
  resized[2] = { ...resized[2], length_m: 4.8 }
  assert.equal(rectangleSize(resized), null)
})

test('assessment rooms with all three measures become boxes, sub-rooms separately', () => {
  const areas = [
    { name: 'Lounge', sqm: 0, length_m: 5, width_m: 4, height_m: 2.4, hazard_level: 1, description: '' },
    { name: 'Hall', sqm: 6, hazard_level: 1, description: '' },
    {
      name: 'Bedroom + Ensuite',
      sqm: 0,
      hazard_level: 1,
      description: '',
      subzones: [
        { id: 'a', name: 'Bedroom', length_m: 4, width_m: 3, height_m: 2.4 },
        { id: 'b', name: 'Ensuite', length_m: 2, width_m: 0, height_m: 2.4 },
      ],
    },
  ] as Area[]
  assert.deepEqual(rectangleRoomsFromAreas(areas).map(room => room.name), ['Lounge', 'Bedroom'])
})
