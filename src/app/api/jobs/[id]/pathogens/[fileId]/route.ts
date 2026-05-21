/*
 * DELETE /api/jobs/[id]/pathogens/[fileId]
 *
 * Removes a single pathogen reference PDF from a job's
 * assessment_data.pathogens_capture.files[] and deletes the underlying object
 * in Supabase storage. Returns the updated job row.
 *
 * If the storage object is missing we still remove the row from the JSON —
 * the in-app record is the source of truth, the storage delete is best-effort.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import type { AssessmentData, Job, PathogensCapture } from '@/lib/types'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'No active organisation' }, { status: 403 })

    const { id: jobId, fileId } = await params

    const supabase = createServiceClient()
    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .select('id, org_id, assessment_data')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle<{ id: string; org_id: string; assessment_data: AssessmentData | null }>()
    if (jobErr) throw jobErr
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const prevCapture: PathogensCapture | undefined = job.assessment_data?.pathogens_capture
    if (!prevCapture?.files?.length) {
      return NextResponse.json({ error: 'No pathogen references on this job' }, { status: 404 })
    }
    const target = prevCapture.files.find(f => f.id === fileId)
    if (!target) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    if (target.storage_path) {
      // Best-effort: missing object is fine.
      await supabase.storage.from('company-assets').remove([target.storage_path])
    }

    const nextCapture: PathogensCapture = {
      ...prevCapture,
      files: prevCapture.files.filter(f => f.id !== fileId),
      updated_at: new Date().toISOString(),
    }
    const nextAssessment: AssessmentData = {
      ...((job.assessment_data ?? {}) as AssessmentData),
      pathogens_capture: nextCapture,
    }

    const { data: updated, error: updErr } = await supabase
      .from('jobs')
      .update({ assessment_data: nextAssessment })
      .eq('id', jobId)
      .eq('org_id', orgId)
      .select('*')
      .single<Job>()
    if (updErr) throw updErr

    return NextResponse.json({ job: updated })
  } catch (err: unknown) {
    console.error('[pathogens/delete]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Delete failed' },
      { status: 500 },
    )
  }
}
