import assert from 'node:assert/strict'
import test from 'node:test'
import { ROOM_MEASURE_WRITE_ATTEMPTS, saveRoomMeasure, type MeasureJobCopy, type MeasureJobStore } from '@/lib/roomMeasureSave'
import { normalizeSurfaceAreaCleaningCapture, type RoomMeasure } from '@/lib/surfaceAreaCleaningQuote'
import type { AssessmentData } from '@/lib/types'

const BEDROOM: RoomMeasure = { id: null, name: 'Bedroom', length_m: 4, width_m: 3, height_m: 2.4 }

/** A job row that behaves like the table: a write lands only when updated_at is still what the writer read. */
function fakeJob(start: Record<string, unknown> | null, opts: { saveElsewhereBeforeWrites?: number } = {}) {
  let row: MeasureJobCopy | null = { assessment_data: start as AssessmentData | null, updated_at: 't0' }
  let tick = 0
  let elsewhere = opts.saveElsewhereBeforeWrites ?? 0
  const writes: boolean[] = []
  const stamp = () => `t${++tick}`
  const store: MeasureJobStore = {
    read: async () => (row ? { ...row } : null),
    async write(assessmentData, expected) {
      if (!row) return false
      if (elsewhere > 0) {
        // Someone saves the laptop quote between this read and this write.
        elsewhere--
        const data = (row.assessment_data ?? {}) as unknown as Record<string, unknown>
        const quote = normalizeSurfaceAreaCleaningCapture(data.surface_area_cleaning_quote)
        row = {
          assessment_data: { ...data, surface_area_cleaning_quote: { ...quote, labour_days: (quote.labour_days ?? 0) + 1 } } as unknown as AssessmentData,
          updated_at: stamp(),
        }
      }
      const landed = row.updated_at === expected
      if (landed) row = { assessment_data: assessmentData, updated_at: stamp() }
      writes.push(landed)
      return landed
    },
  }
  return {
    store,
    writes,
    quote: () => normalizeSurfaceAreaCleaningCapture((row?.assessment_data as unknown as Record<string, unknown> | null)?.surface_area_cleaning_quote),
    data: () => row?.assessment_data as unknown as Record<string, unknown>,
    remove: () => { row = null },
  }
}

test('a measured room is saved onto the quote and the rest of the job is left alone', async () => {
  const job = fakeJob({ observations: 'Odour in hallway.', biohazard_cleaning_quote: { rooms: [1] }, surface_area_cleaning_quote: { rate_per_m2: 12 } })
  const saved = await saveRoomMeasure(job.store, BEDROOM)
  assert.ok(!('error' in saved))
  assert.deepEqual(job.writes, [true])
  assert.deepEqual(job.quote().rooms.map(room => room.name), ['Bedroom'])
  assert.equal(job.quote().estimated_m2, 57.6)
  assert.equal(job.quote().rate_per_m2, 12)
  assert.equal(job.data().observations, 'Odour in hallway.')
  assert.deepEqual(job.data().biohazard_cleaning_quote, { rooms: [1] })
})

test('a job with no quote yet gets one with the room on it', async () => {
  const job = fakeJob(null)
  const saved = await saveRoomMeasure(job.store, BEDROOM)
  assert.ok(!('error' in saved))
  assert.deepEqual(job.quote().rooms.map(room => room.name), ['Bedroom'])
  assert.ok(Array.isArray(job.data().areas))
})

test('a save made elsewhere between the read and the write is kept, and the room still lands', async () => {
  const job = fakeJob({ surface_area_cleaning_quote: { labour_days: 2, rooms: [{ id: 'r1', name: 'Kitchen', length_m: 4, width_m: 3.2, height_m: 2.4 }] } }, { saveElsewhereBeforeWrites: 2 })
  const saved = await saveRoomMeasure(job.store, BEDROOM)
  assert.ok(!('error' in saved))
  assert.deepEqual(job.writes, [false, false, true])
  // Both of the other saves survive, and so does the room.
  assert.equal(job.quote().labour_days, 4)
  assert.deepEqual(job.quote().rooms.map(room => room.name), ['Kitchen', 'Bedroom'])
})

test('two rooms saved one after the other are both on the quote', async () => {
  const job = fakeJob({})
  await saveRoomMeasure(job.store, BEDROOM)
  await saveRoomMeasure(job.store, { ...BEDROOM, name: 'Hall', length_m: 6, width_m: 1.2 })
  assert.deepEqual(job.quote().rooms.map(room => room.name), ['Bedroom', 'Hall'])
})

test('it gives up, without writing, when the job keeps being saved elsewhere', async () => {
  const job = fakeJob({}, { saveElsewhereBeforeWrites: 99 })
  const saved = await saveRoomMeasure(job.store, BEDROOM)
  assert.deepEqual(saved, { error: 'The quote is being saved somewhere else. Try again.', status: 409 })
  assert.equal(job.writes.length, ROOM_MEASURE_WRITE_ATTEMPTS)
  assert.ok(job.writes.every(landed => !landed))
  assert.deepEqual(job.quote().rooms, [])
})

test('a job that is gone, or a quote that is full, is refused', async () => {
  const gone = fakeJob({})
  gone.remove()
  assert.deepEqual(await saveRoomMeasure(gone.store, BEDROOM), { error: 'That job is not open.', status: 404 })

  const rooms = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, name: `Room ${i + 1}`, length_m: 3, width_m: 3, height_m: 2.4 }))
  const full = fakeJob({ surface_area_cleaning_quote: { rooms } })
  assert.deepEqual(await saveRoomMeasure(full.store, BEDROOM), { error: 'This quote already has 100 rooms.', status: 400 })
  assert.deepEqual(full.writes, [])
})
