/*
 * lib/agent/subagents/generate.ts
 *
 * Loads what a document needs to be generated on the server (the job, and per
 * definition its saved documents, the company profile, report photos and
 * notes), then runs the definition's compose and checks.
 */
import type { createServiceClient } from '@/lib/supabase'
import type { CompanyProfile, Document, Job, Photo, ProgressNote, ProgressRoomNote } from '@/lib/types'
import { docAgent } from './registry'
import type { DocAgentType, GenerateCheck, GenerateInputs } from './types'

type Supabase = ReturnType<typeof createServiceClient>

export async function loadGenerateInputs(supabase: Supabase, orgId: string, jobId: string, type: DocAgentType): Promise<GenerateInputs | null> {
  const needs = new Set(docAgent(type).generateNeeds)
  const empty = Promise.resolve({ data: null as unknown })
  const [jobRes, docsRes, companyRes, photosRes, notesRes, roomNotesRes] = await Promise.all([
    supabase.from('jobs').select('*').eq('id', jobId).eq('org_id', orgId).maybeSingle(),
    needs.has('documents')
      ? supabase.from('documents').select('*').eq('job_id', jobId).eq('org_id', orgId).order('created_at', { ascending: false })
      : empty,
    needs.has('company') ? supabase.from('company_profile').select('*').eq('org_id', orgId).limit(1).maybeSingle() : empty,
    needs.has('report_media') ? supabase.from('photos').select('*').eq('job_id', jobId).order('uploaded_at', { ascending: false }) : empty,
    needs.has('report_media')
      ? supabase.from('progress_notes').select('*').eq('job_id', jobId).eq('org_id', orgId).is('deleted_at', null).order('created_at', { ascending: true })
      : empty,
    needs.has('report_media') ? supabase.from('progress_room_notes').select('*').eq('job_id', jobId).eq('org_id', orgId) : empty,
  ])
  if (!jobRes.data) return null
  return {
    job: jobRes.data as Job,
    documents: (docsRes.data ?? []) as Document[],
    company: (companyRes.data ?? null) as CompanyProfile | null,
    photos: (photosRes.data ?? []) as Photo[],
    progressNotes: (notesRes.data ?? []) as ProgressNote[],
    progressRoomNotes: (roomNotesRes.data ?? []) as ProgressRoomNote[],
  }
}

export async function checkGenerate(supabase: Supabase, orgId: string, jobId: string, type: DocAgentType): Promise<GenerateCheck> {
  const inputs = await loadGenerateInputs(supabase, orgId, jobId, type)
  if (!inputs) return { ok: false, reason: 'Job not found' }
  return docAgent(type).generate(inputs)
}
