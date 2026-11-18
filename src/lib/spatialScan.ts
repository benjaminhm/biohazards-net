/*
 * LiDAR scan files for a job (migration 083).
 * The phone asks POST /api/photo/scan for signed upload URLs, puts the
 * USDZ, MP4 and timeline straight into the private job-scans bucket, then
 * POST /api/photo/scan/complete marks the row ready for the job file.
 */

export const JOB_SCANS_BUCKET = 'job-scans'
/** Matches the bucket file_size_limit in migration 083. */
export const SCAN_FILE_MAX_BYTES = 100 * 1024 * 1024

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isScanUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export function scanObjectPaths(orgId: string, jobId: string, scanId: string) {
  const base = `${orgId}/${jobId}/${scanId}`
  return {
    mesh: `${base}/mesh.usdz`,
    video: `${base}/walkthrough.mp4`,
    timeline: `${base}/timeline.json`,
  }
}

export interface ScanStartInput {
  note: string
  startedAt: string
  durationS: number | null
  jobCode: string
  jobId: string
  lat: number | null
  lng: number | null
  accuracyM: number | null
}

function optionalNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** Reads the phone's start-scan body. Job resolution happens after this. */
export function parseScanStart(body: unknown): ScanStartInput | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Missing scan details.' }
  const raw = body as Record<string, unknown>
  const startedRaw = typeof raw.started_at === 'string' ? raw.started_at.trim() : ''
  const startedMs = Date.parse(startedRaw)
  if (!startedRaw || !Number.isFinite(startedMs)) return { error: 'Missing scan start time.' }
  const duration = optionalNumber(raw.duration_s)
  if (duration != null && (duration < 0 || duration > 60 * 30)) return { error: 'Scan duration is not valid.' }
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 240) : ''
  const jobCode = typeof raw.job_code === 'string' ? raw.job_code.trim().toUpperCase().slice(0, 32) : ''
  const jobId = typeof raw.job_id === 'string' ? raw.job_id.trim() : ''
  if (jobId && !isScanUuid(jobId)) return { error: 'That job is not valid.' }
  if (!jobId && !jobCode) return { error: 'Choose a job before scanning.' }
  return {
    note,
    startedAt: new Date(startedMs).toISOString(),
    durationS: duration,
    jobCode,
    jobId,
    lat: optionalNumber(raw.lat),
    lng: optionalNumber(raw.lng),
    accuracyM: optionalNumber(raw.accuracy_m),
  }
}
