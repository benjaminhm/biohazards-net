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
import { postMessage } from '@/lib/agent/drafts'
import type { AssessmentData } from '@/lib/types'
import { parseVoipPayload } from './payload'
import { transcribeRecording } from './transcribe'
import { cleanTranscript } from './clean'
import { extractionIssues, normalizeExtraction, runHeadAgent, type CallExtraction } from './extraction'
import { CONTACT_FIELDS, callNoteBody, contactPatch, placeholderName, quoteDrafts, type ContactField } from './fileAgent'
import { orderedRecordingRefs, type RecordingPart } from './recordingEmail'

export const CALL_STAGES = ['transcribe', 'clean', 'extract', 'file'] as const
export type CallStage = (typeof CALL_STAGES)[number]

type Supabase = ReturnType<typeof createServiceClient>

interface CallRow {
  id: string
  org_id: string
  provider: string
  caller_number: string
  started_at: string | null
  recording_url: string
  recording_parts: RecordingPart[] | null
  payload_raw: Record<string, unknown>
  transcript_raw: string | null
  transcript_source: string | null
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
  // Written enquiries arrive as text: there is no audio to transcribe or speech to clean.
  const written = call.transcript_source === 'form' && Boolean(call.transcript_raw)
  try {
    let raw = call.transcript_raw
    if (!written && (at('transcribe') || !raw)) {
      const provided = parseVoipPayload(call.payload_raw).transcript
      let source: 'provider' | 'openai'
      if (provided) {
        raw = provided
        source = 'provider'
      } else if (call.recording_url || call.recording_parts?.length) {
        const texts: string[] = []
        for (const ref of orderedRecordingRefs(call.recording_parts ?? [], call.recording_url)) {
          texts.push((await transcribeRecording(ref)).text)
        }
        raw = texts.join('\n')
        source = 'openai'
      } else {
        throw new Error('The webhook had no recording link and no transcript')
      }
      await update({ transcript_raw: raw, transcript_source: source, status: 'transcribed', error: null, error_stage: null })
    }
    if (!raw) throw new Error('No transcript')

    const apiKey = getAnthropicApiKey()
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

    stage = 'clean'
    let clean = call.transcript_clean ?? (written ? raw : null)
    let unclear = call.clean_unclear ?? []
    if (!written && (at('clean') || !clean)) {
      const c = await cleanTranscript(raw, apiKey)
      clean = c.transcript
      unclear = c.unclear
      await update({ transcript_clean: clean, clean_changes: c.changes, clean_unclear: c.unclear, status: 'cleaned' })
    }
    if (!clean) throw new Error('No cleaned transcript')

    stage = 'extract'
    let extraction = call.extraction ? normalizeExtraction(call.extraction) : null
    if (at('extract') || !extraction) {
      const r = await runHeadAgent(clean, call.caller_number, apiKey)
      extraction = normalizeExtraction(r.raw)
      await update({ extraction, extraction_raw: r.raw, extraction_model: r.model, status: 'extracted' })
    }

    stage = 'file'
    await fileCall(supabase, call, extraction, unclear)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pipeline failed'
    console.error('[inbound_call]', callId, stage, message)
    await update({ status: 'failed', error: message, error_stage: stage })
  }
}

/**
 * Run the pipeline once a call's recording parts stop arriving. Each emailed
 * part schedules this; only the run that saw the latest part goes ahead.
 */
export async function processCallWhenSettled(callId: string, partCount: number): Promise<void> {
  const waitMs = Number(process.env.CALL_PARTS_WAIT_MS ?? 45_000)
  await new Promise(resolve => setTimeout(resolve, waitMs))
  const supabase = createServiceClient()
  const { data } = await supabase.from('inbound_calls').select('recording_parts').eq('id', callId).maybeSingle()
  if (!data) return
  if (((data.recording_parts ?? []) as unknown[]).length > partCount) return
  await processCall(callId, 'transcribe')
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
  // A call that already has a job is re-filed into that job, never a new one.
  const heardPhone = formatToTwilioE164(e.contact.phone) ?? ''
  const phones = [...new Set([call.caller_number, heardPhone].filter(Boolean))]
  const refiling = Boolean(call.job_id)
  const matched = refiling ? null : await findOpenJobByPhone(supabase, call.org_id, phones)

  let jobId: string
  let jobCode: string | null
  let decision: 'created' | 'attached' | 'refiled'
  if (call.job_id) {
    jobId = call.job_id
    jobCode = ((call.filed as { job_code?: string } | null)?.job_code) ?? null
    decision = 'refiled'
  } else if (matched) {
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
      client_name: e.contact.name || placeholderName(call.caller_number),
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

  // One call note per call; a re-file keeps the first.
  const previousNoteId = (call.filed as { note_id?: string } | null)?.note_id ?? null
  let noteId = previousNoteId
  if (!previousNoteId) {
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
    noteId = note.id as string
    await logAgentAction(supabase, {
      org_id: call.org_id, job_id: jobId, agent: 'file_agent', trigger, action: 'add_progress_note',
      target_table: 'progress_notes', target_id: noteId, after: { body },
    })
  }

  await setCall({
    validation: { issues, decision, matched_job_id: matched?.id ?? null },
    filed: {
      job_id: jobId,
      job_code: jobCode,
      fields: Object.keys(patch),
      drafts: drafts.map(d => d.key),
      skipped,
      conflicts,
      note_id: noteId,
      ...(refiling ? { refiled_at: new Date().toISOString() } : {}),
    },
    status: issues.length ? 'needs_review' : 'filed',
  })

  try {
    await postMessage(supabase, {
      org_id: call.org_id, thread_id: null, job_id: jobId, speaker: 'file_agent', author: 'Call agent',
      content: { text: filedFeedText(call, e, decision, Object.keys(patch), drafts.map(d => d.key), issues) },
    })
  } catch (err) {
    console.error('[pipeline] job feed post failed', err)
  }
}

function filedFeedText(
  call: Pick<CallRow, 'provider' | 'caller_number'>,
  e: CallExtraction,
  decision: 'created' | 'attached' | 'refiled',
  fields: string[],
  drafts: string[],
  issues: string[],
): string {
  const what = call.provider === 'netlify_form' ? 'Website enquiry' : `Call${call.caller_number ? ` from ${call.caller_number}` : ''}`
  const how = decision === 'created' ? 'New job created.' : decision === 'attached' ? 'Attached to this open job by phone number.' : 'Re-filed into this job.'
  return [
    `${what} filed. ${how}`,
    e.summary,
    fields.length ? `Filled: ${fields.map(f => f.replace(/_/g, ' ')).join(', ')}.` : '',
    drafts.length ? `Drafted (prices blank): ${drafts.map(d => d.replace(/_/g, ' ')).join(', ')}.` : '',
    issues.length ? `Check: ${issues.join(' ')}` : '',
  ].filter(Boolean).join('\n')
}
