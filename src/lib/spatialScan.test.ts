import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isScanUuid, parseScanStart, scanObjectPaths, SCAN_FILE_MAX_BYTES } from './spatialScan'

const JOB = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const SCAN = '33333333-3333-4333-8333-333333333333'

test('scan paths stay inside the org, job and scan folder', () => {
  const paths = scanObjectPaths(ORG, JOB, SCAN)
  assert.equal(paths.mesh, `${ORG}/${JOB}/${SCAN}/mesh.usdz`)
  assert.equal(paths.video, `${ORG}/${JOB}/${SCAN}/walkthrough.mp4`)
  assert.equal(paths.timeline, `${ORG}/${JOB}/${SCAN}/timeline.json`)
  assert.equal(paths.mesh.includes('..'), false)
})

test('a scan id has to be a uuid', () => {
  assert.equal(isScanUuid(SCAN), true)
  assert.equal(isScanUuid('../mesh.usdz'), false)
  assert.equal(isScanUuid(''), false)
})

test('start body keeps a note, a start time and a job', () => {
  const parsed = parseScanStart({
    job_id: JOB,
    job_code: 'ab12',
    note: '  kitchen  ',
    started_at: '2026-11-18T08:00:00.000Z',
    duration_s: 42,
    lat: -27.4,
    lng: 153.0,
    accuracy_m: 5,
  })
  assert.ok(!('error' in parsed))
  if ('error' in parsed) return
  assert.equal(parsed.note, 'kitchen')
  assert.equal(parsed.jobCode, 'AB12')
  assert.equal(parsed.jobId, JOB)
  assert.equal(parsed.durationS, 42)
  assert.equal(parsed.startedAt, '2026-11-18T08:00:00.000Z')
  assert.equal(parsed.lat, -27.4)
})

test('start body refuses a scan with no job and a bad clock', () => {
  assert.deepEqual(parseScanStart({ note: 'x' }), { error: 'Missing scan start time.' })
  assert.deepEqual(parseScanStart({ started_at: 'yesterday', job_code: '1234' }), { error: 'Missing scan start time.' })
  assert.deepEqual(parseScanStart({ started_at: '2026-11-18T08:00:00Z' }), { error: 'Choose a job before scanning.' })
  assert.equal(SCAN_FILE_MAX_BYTES, 100 * 1024 * 1024)
})
