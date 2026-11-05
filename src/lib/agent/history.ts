/*
 * lib/agent/history.ts
 *
 * Conversation helpers for the stateless agent route: the client owns the
 * history, so the server has to keep it valid for the Messages API.
 */
import type Anthropic from '@anthropic-ai/sdk'

type Msg = Anthropic.MessageParam

export const DECLINED = 'The staff member declined this action. It was not carried out.'

/** Keep the tail of the conversation, starting at a plain user turn so no tool_result is orphaned. */
export function trimHistory(messages: Msg[], max: number): Msg[] {
  if (messages.length <= max) return messages
  const tail = messages.slice(-max)
  const start = tail.findIndex(m => m.role === 'user' && typeof m.content === 'string')
  return start >= 0 ? tail.slice(start) : tail
}

export function lastToolUse(messages: Msg[]): Anthropic.ToolUseBlockParam | null {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant' || typeof last.content === 'string') return null
  return (last.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlockParam | undefined) ?? null
}

export function toolResult(id: string, content: string, is_error: boolean): Msg {
  return { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] }
}

/** A new user message sent while a write was awaiting approval counts as declining it. */
export function closeSkippedApproval(messages: Msg[]): Msg[] {
  const last = messages[messages.length - 1]
  const pending = lastToolUse(messages.slice(0, -1))
  if (!pending || last?.role !== 'user' || typeof last.content !== 'string') return messages
  return [
    ...messages.slice(0, -1),
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: pending.id, content: DECLINED },
        { type: 'text', text: last.content },
      ],
    },
  ]
}
