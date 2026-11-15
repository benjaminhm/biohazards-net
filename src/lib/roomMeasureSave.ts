/*
 * lib/roomMeasureSave.ts
 *
 * Saving one room measured on the phone (room measure link, migration 081) onto
 * a job's surface area cleaning quote.
 *
 * The quote lives inside jobs.assessment_data, and every save writes that whole.
 * So the room is written only if the job has not been saved since it was read.
 * If it has, the job is read again and the room is applied to that copy, so
 * neither save drops the other's work.
 */
import { mergeAssessmentData } from '@/lib/riskDerivation'
import {
  applyRoomMeasure,
  normalizeSurfaceAreaCleaningCapture,
  type RoomMeasure,
  type SurfaceAreaCleaningCapture,
  type SurfaceAreaRoom,
} from '@/lib/surfaceAreaCleaningQuote'
import type { AssessmentData } from '@/lib/types'

export const ROOM_MEASURE_WRITE_ATTEMPTS = 5

export interface MeasureJobCopy {
  assessment_data: AssessmentData | null
  updated_at: string | null
}

export interface MeasureJobStore {
  /** The job as saved now. Null when it is gone or archived. */
  read(): Promise<MeasureJobCopy | null>
  /** Writes only if the job's updated_at is still `expected`. False when it was saved since. */
  write(assessmentData: AssessmentData, expected: string | null): Promise<boolean>
}

export type RoomMeasureSaved =
  | { capture: SurfaceAreaCleaningCapture; room: SurfaceAreaRoom }
  | { error: string; status: number }

export async function saveRoomMeasure(store: MeasureJobStore, measure: RoomMeasure): Promise<RoomMeasureSaved> {
  for (let attempt = 0; attempt < ROOM_MEASURE_WRITE_ATTEMPTS; attempt++) {
    const job = await store.read()
    if (!job) return { error: 'That job is not open.', status: 404 }
    const applied = applyRoomMeasure(normalizeSurfaceAreaCleaningCapture(job.assessment_data?.surface_area_cleaning_quote), measure)
    if (typeof applied === 'string') return { error: applied, status: 400 }
    const next = { ...mergeAssessmentData(job.assessment_data), surface_area_cleaning_quote: applied.capture } as AssessmentData
    if (await store.write(next, job.updated_at)) return applied
  }
  return { error: 'The quote is being saved somewhere else. Try again.', status: 409 }
}
