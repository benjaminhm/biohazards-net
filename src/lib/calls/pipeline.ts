/*
 * lib/calls/pipeline.ts
 *
 * Inbound call pipeline. Each stage writes its own output to inbound_calls so
 * a wrong field can be traced to the stage that produced it:
 *
 *   received → transcribe → clean → extract (head agent) → file (file agent)
 *
 * Head agent: decides what the call is, then creates a lead job or attaches the
 * call to an open job with the same phone number.
 * File agent: fills that one job — empty contact fields, quote drafts without
 * prices, quotes required, and a progress note.
 *
 * Every job write is logged in agent_actions. Nothing is sent to anyone.
 */
import { createServiceClient } from '@/lib/supabase'
import { getAnthropicApiKey } from '@/lib/loadAnthropicEnvFallback'
import { generateUniqueJobCode } from '@/lib/jobCode'
import { ensureJobInboundEmailToken } from '@/lib/jobInboundEmail'
import { formatToTwilioE164 } from '@/lib/phone'
import { logAgentAction } from '@/lib/agentActions'
import type { AssessmentData } from '@/lib/types'
import { parseVoipPayload } from './payload'
import { transcribeRecording } from './transcribe'
import { cleanTranscript } from './clean'
import { extractionIssues, normalizeExtraction, runHeadAgent, type CallExtraction } from './extraction'
import { CONTACT_FIELDS, callNoteBody, contactPatch, quoteDrafts, type ContactField } from './fileAgent'

export const CALL_STAGES = ['transcribe', 'clean', 'extract', 'file'] as const
export type CallStage = (typeof CALL_STAGES)[number]

type Supabase = ReturnType<typeof createServiceClient>

interface CallRow {
  id: string
  org_id: string
  caller_number: string
  started_at: string | null
  recording_url: string
  payload_raw: Record<string, unknown>
  transcript_raw: string | null
  transcript_clean: string | null
  clean_unclear: string[] | null
  extraction: unknown
  job_id: string | null
  filed: unknown
}

const OPEN_JOB_WINDOW_DAYS = 120

export async function processCall(callId: string, from: CallStage = 'transcribe'): Promise<void> {
  const supabase = createServiceClient()
  const { data } = await supabase.from('inbound_calls').select('*').eq('id', callId).maybeSingle()
  if (!data) return
  const call = data as CallRow
  const at = (s: CallStage) => CALL_STAGES.indexOf(from) <= CALL_STAGES.indexOf(s)
  const update = (patch: Record<string, unknown>) =>
    supabase.from('inbound_calls').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', callId)

  let stage: CallStage = 'transcribe'
  try {
    let raw = call.transcript_raw
    if (at('transcribe') || !raw) {
      const provided = parseVoipPayload(call.payload_raw).transcript
      let source: 'provider' | 'openai'
      if (provided) {
        raw = provided
        source = 'provider'
      } else if (call.recording_url) {
        raw = (await transcribeRecording(call.recording_url)).text
        source = 'openai'
      } else {
        throw new Error('The webhook had no recording link and no transcript')
      }
      await update({ transcript_raw: raw, transcript_source: source, status: 'transcribed', error: null, error_stage: null })
    }

    const apiKey = getAnthropicApiKey()
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

    stage = 'clean'
    let clean = call.transcript_clean
    let unclear = call.clean_unclear ?? []
    if (at('clean') || !clean) {
      const c = await cleanTranscript(raw, apiKey)
      clean = c.transcript
      unclear = c.unclear
      await update({ transcript_clean: clean, clean_changes: c.changes, clean_unclear: c.unclear, status: 'cleaned' })
    }

    stage = 'extract'
    let extraction = call.extraction ? normalizeExtraction(call.extraction) : null
    if (at('extract') || !extraction) {
      const r = await runHeadAgent(clean, call.caller_number, apiKey)
      extraction = normalizeExtraction(r.raw)
      await update({ extraction, extraction_model: r.model, status: 'extracted' })
    }

    stage = 'file'
    if (call.job_id && call.filed) {
      await update({ status: 'filed' })
      return
    }
    await fileCall(supabase, call, extraction, unclear)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pipeline failed'
    console.error('[inbound_call]', callId, stage, message)
    await update({ status: 'failed', error: message, error_stage: stage })
  }
}

async function findOpenJobByPhone(supabase: Supabase, orgId: string, phones: string[]) {
  if (!phones.length) return null
  const since = new Date(Date.now() - OPEN_JOB_WINDOW_DAYS * 86_400_000).toISOString()
  const or = phones.flatMap(p => [`client_phone.eq."${p}"`, `site_contact_phone.eq."${p}"`]).join(',')
  const { data } = await supabase
    .from('jobs')
    .select('id, job_code')
    .eq('org_id', orgId)
    .is('archived_at', null)
    .not('status', 'in', '(completed,report_sent,paid)')
    .gte('created_at', since)
    .or(or)
    .order('created_at', { ascending: false })
    .limit(1)
  return (data?.[0] as { id: string; job_code: string | null } | undefined) ?? null
}

async function fileCall(supabase: Supabase, call: CallRow, e: CallExtraction, cleanUnclear: string[]) {
  const trigger = `inbound_call:${call.id}`
  const issues = [...extractionIssues(e, call.caller_number), ...cleanUnclear.map(u => `Unclear in the recording: ${u}`)]
  const setCall = (patch: Record<string, unknown>) =>
    supabase.from('inbound_calls').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', call.id)

  if (!e.is_job_enquiry) {
    await setCall({ validation: { issues, decision: 'not_a_job' }, status: 'needs_review' })
    return
  }

  // ── Head agent: create or attach ────────────────────────────────────────────
  const heardPhone = formatToTwilioE164(e.contact.phone) ?? ''
  const phones = [...new Set([call.caller_number, heardPhone].filter(Boolean))]
  const matched = await findOpenJobByPhone(supabase, call.org_id, phones)

  let jobId: string
  let jobCode: string | null
  let decision: 'created' | 'attached'
  if (matched) {
    jobId = matched.id
    jobCode = matched.job_code
    decision = 'attached'
    issues.push(`Attached to open job ${matched.job_code ?? matched.id} with the same phone number — check it is the same job`)
    await logAgentAction(supabase, {
      org_id: call.org_id, job_id: jobId, agent: 'head_agent', trigger, action: 'attach_call_to_job',
      target_table: 'jobs', target_id: jobId, after: { phones }, status: 'needs_review',
      note: 'Matched an open job by phone number.',
    })
  } else {
    jobCode = await generateUniqueJobCode(supabase, call.org_id)
    const row = {
      job_code: jobCode,
      client_name: e.contact.name || (call.caller_number ? `Caller ${call.caller_number}` : 'Unknown caller'),
      client_phone: heardPhone || call.caller_number,
      site_address: e.site.address,
      job_type: 'other',
      urgency: e.urgency,
      status: 'lead',
      notes: '',
      assessment_data: null,
      org_id: call.org_id,
    }
    const { data, error } = await supabase.from('jobs').insert(row).select('id').single()
    if (error) throw error
    jobId = data.id as string
    decision = 'created'
    await ensureJobInboundEmailToken(jobId, call.org_id)
    await logAgentAction(supabase, {
      org_id: call.org_id, job_id: jobId, agent: 'head_agent', trigger, action: 'create_job',
      target_table: 'jobs', target_id: jobId, after: row, note: 'New lead job from an inbound call.',
    })
  }
  await setCall({ job_id: jobId, validation: { issues, decision, matched_job_id: matched?.id ?? null } })

  // ── File agent: this job only ───────────────────────────────────────────────
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select(`id, ${CONTACT_FIELDS.join(', ')}, assessment_data`)
    .eq('id', jobId)
    .eq('org_id', call.org_id)
    .single()
  if (jobErr || !job) throw jobErr ?? new Error('Job not found after create')
  const jobRow = job as unknown as Partial<Record<ContactField, string | null>> & { assessment_data: AssessmentData | null }

  const { patch, before, conflicts } = contactPatch(jobRow, e, call.caller_number)
  if (Object.keys(patch).length) {
    const { error } = await supabase.from('jobs').update(patch).eq('id', jobId).eq('org_id', call.org_id)
    if (error) throw error
    await logAgentAction(supabase, {
      org_id: call.org_id, job_id: jobId, agent: 'file_agent', trigger, action: 'fill_contact_fields',
      target_table: 'jobs', target_id: jobId, before, after: patch,
    })
  }
  for (const c of conflicts) {
    issues.push(`Not overwritten: ${c.field.replace(/_/g, ' ')} is "${c.existing}" on file, the call said "${c.heard}"`)
  }
  if (conflicts.length) {
    await logAgentAction(supabase, {
      org_id: call.org_id, job_id: jobId, agent: 'file_agent', trigger, action: 'field_conflicts',
      target_table: 'jobs', target_id: jobId, after: conflicts, status: 'needs_review',
      note: 'Fields already filled on the job were left as they are.',
    })
  }

  const ad = jobRow.assessment_data
  const { drafts, skipped, quotes_required } = quoteDrafts(ad, e, call.id)
  if (drafts.length || quotes_required.length) {
    const nextAd: AssessmentData = { ...(ad ?? ({} as AssessmentData)), quotes_required }
    for (const d of drafts) (nextAd as unknown as Record<string, unknown>)[d.key] = d.capture
    const { error } = await supabase.from('jobs').update({ assessment_data: nextAd }).eq('id', jobId).eq('org_id', call.org_id)
    if (error) throw error
    for (const d of drafts) {
      await logAgentAction(supabase, {
        org_id: call.org_id, job_id: jobId, agent: 'file_agent', trigger, action: 'draft_quote',
        target_table: 'jobs', target_id: jobId, target_path: `assessment_data.${d.key}`,
        before: null, after: d.capture, note: 'Quantities and wording only. Prices left for staff.',
      })
    }
    await logAgentAction(supabase, {
      org_id: call.org_id, job_id: jobId, agent: 'file_agent', trigger, action: 'set_quotes_required',
      target_table: 'jobs', target_id: jobId, target_path: 'assessment_data.quotes_required',
      before: ad?.quotes_required ?? null, after: quotes_required,
    })
  }
  for (const s of skipped) issues.push(`${s.key.replace(/_/g, ' ')}: ${s.reason}`)

  const body = callNoteBody(e, call)
  const { data: note, error: noteErr } = await supabase
    .from('progress_notes')
    .insert({
      org_id: call.org_id,
      job_id: jobId,
      room: '',
      body,
      created_by_user_id: 'agent:call',
      updated_by_user_id: 'agent:call',
      created_by_first_name: 'Call agent',
      updated_by_first_name: 'Call agent',
    })
    .select('id')
    .single()
  if (noteErr) throw noteErr
  await logAgentAction(supabase, {
    org_id: call.org_id, job_id: jobId, agent: 'file_agent', trigger, action: 'add_progress_note',
    target_table: 'progress_notes', target_id: note.id as string, after: { body },
  })

  await setCall({
    validation: { issues, decision, matched_job_id: matched?.id ?? null },
    filed: {
      job_id: jobId,
      job_code: jobCode,
      fields: Object.keys(patch),
      drafts: drafts.map(d => d.key),
      skipped,
      conflicts,
      note_id: note.id,
    },
    status: issues.length ? 'needs_review' : 'filed',
  })
}
