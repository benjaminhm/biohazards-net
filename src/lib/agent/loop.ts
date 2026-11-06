/*
 * lib/agent/loop.ts
 *
 * The tool loop shared by the workspace agents (head agent, file agent and the
 * per-document sub-agents): one model call per step, at most one tool per
 * step, tool errors handed back to the model as is_error results.
 */
import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'

export type Input = Record<string, unknown>

export interface AgentTool<C> {
  name: string
  description: string
  input_schema: Anthropic.Tool.InputSchema
  run: (ctx: C, input: Input) => Promise<unknown>
}

/** A refusal the model should read and act on (not a crash). */
export class ToolError extends Error {}

export function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export interface LoopOptions {
  stopWhen?: () => boolean
  maxSteps?: number
  maxTokens?: number
  onToolResult?: (name: string, content: string, isError: boolean) => void
}

export async function runLoop<C>(
  anthropic: Anthropic,
  system: string,
  tools: AgentTool<C>[],
  messages: Anthropic.MessageParam[],
  ctx: C,
  opts: LoopOptions = {},
): Promise<string> {
  const maxSteps = opts.maxSteps ?? 10
  const defs = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
  const texts: string[] = []
  for (let step = 0; step < maxSteps; step++) {
    const res = await anthropic.messages.create({
      model: CLAUDE_SONNET_MODEL,
      max_tokens: opts.maxTokens ?? 1500,
      system,
      tools: defs,
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      messages,
    })
    messages.push({ role: 'assistant', content: res.content })
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text.trim()).filter(Boolean).join('\n\n')
    if (text) texts.push(text)
    const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (res.stop_reason !== 'tool_use' || !use) return texts.join('\n\n')

    const tool = tools.find(t => t.name === use.name)
    let content: string
    let isError = false
    if (!tool) {
      content = `Unknown tool: ${use.name}`
      isError = true
    } else {
      try {
        content = JSON.stringify(await tool.run(ctx, (use.input ?? {}) as Input))
      } catch (err) {
        content = err instanceof Error ? err.message : 'Tool failed'
        isError = true
      }
    }
    opts.onToolResult?.(use.name, content, isError)
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: use.id, content, is_error: isError }] })
    if (opts.stopWhen?.()) return texts.join('\n\n')
  }
  texts.push('That took more steps than I allow in one go. Tell me what to do next.')
  return texts.join('\n\n')
}
