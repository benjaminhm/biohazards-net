/*
 * lib/calls/clean.ts
 *
 * Stage 2 of the call pipeline: tidy the raw transcript before anything reads
 * it for data. Two passes:
 *   1. Code: whitespace, speaker labels, repeated lines. Predictable and tested.
 *   2. Model: fix misheard words, apply the caller's own corrections, drop
 *      filler. Every change is listed; anything unclear is flagged, not guessed.
 * Cleaning never extracts fields or decides anything — that is the head agent.
 */
import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'

export interface CleanChange {
  from: string
  to: string
  reason: string
}

export interface CleanResult {
  transcript: string
  changes: CleanChange[]
  unclear: string[]
}

/** Code pass. */
export function tidyTranscript(raw: string): string {
  const speakerNames = new Map<string, string>()
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .map(line =>
      line.replace(/^(?:\[?\s*)?(speaker[ _-]?\d+|spk[ _-]?\d+|channel[ _-]?\d+)(?:\s*\])?\s*[:\-–]\s*/i, (_m, label: string) => {
        const key = label.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (!speakerNames.has(key)) speakerNames.set(key, `Speaker ${speakerNames.size + 1}`)
        return `${speakerNames.get(key)}: `
      }),
    )
  const out: string[] = []
  for (const line of lines) {
    if (out[out.length - 1] !== line) out.push(line)
  }
  return out.join('\n')
}

const SYSTEM = `You clean phone call transcripts for an Australian biohazard and trauma cleaning company before the details are filed. The call is between a staff member and a caller (client, family member, property manager, police, insurer, etc.).

Do:
- Fix words the speech-to-text clearly misheard, using context (e.g. "by a hazard" -> "biohazard", misheard Queensland suburb names).
- Where the caller corrects themselves ("it's 40, sorry, 14 square metres"), keep only the corrected value.
- Remove filler (um, ah, like, you know) and false starts, keeping meaning and every fact.
- Label speakers as "Staff:" and "Caller:" when you can tell who is who; otherwise keep the existing labels.
- Keep numbers, names, phone numbers, emails, addresses and dates exactly as said, apart from obvious mishearings.

Do not:
- Summarise, shorten facts, reorder, or add anything not said.
- Guess. If a name, number, address or email is unclear, leave it as heard and list it in "unclear".

List every substantive change (mishearing fixes, applied corrections, speaker relabelling once) in "changes". Do not list filler removal.`

const TOOL: Anthropic.Tool = {
  name: 'cleaned_transcript',
  description: 'Return the cleaned transcript with a list of changes and unclear items.',
  input_schema: {
    type: 'object',
    properties: {
      transcript: { type: 'string' },
      changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: { from: { type: 'string' }, to: { type: 'string' }, reason: { type: 'string' } },
          required: ['from', 'to', 'reason'],
        },
      },
      unclear: { type: 'array', items: { type: 'string' } },
    },
    required: ['transcript', 'changes', 'unclear'],
  },
}

export async function cleanTranscript(raw: string, apiKey: string): Promise<CleanResult & { model: string }> {
  const tidy = tidyTranscript(raw)
  if (tidy.length < 40) return { transcript: tidy, changes: [], unclear: [], model: 'code-only' }

  const anthropic = new Anthropic({ apiKey })
  const res = await anthropic.messages.create({
    model: CLAUDE_SONNET_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content: `TRANSCRIPT:\n${tidy}` }],
  })
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  const input = (use?.input ?? {}) as Partial<CleanResult>
  const transcript = typeof input.transcript === 'string' ? input.transcript.trim() : ''
  if (!transcript || res.stop_reason === 'max_tokens') {
    throw new Error(res.stop_reason === 'max_tokens' ? 'Cleaned transcript was cut off (too long)' : 'Cleaner returned no transcript')
  }
  return {
    transcript,
    changes: Array.isArray(input.changes) ? input.changes.filter(c => c && typeof c.from === 'string') : [],
    unclear: Array.isArray(input.unclear) ? input.unclear.filter((u): u is string => typeof u === 'string') : [],
    model: CLAUDE_SONNET_MODEL,
  }
}
