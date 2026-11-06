'use client'

/*
 * components/workspace/JobAgentList.tsx
 *
 * Under an expanded job in the workspace list: the File agent and the seven
 * document agents. Each row shows where its document is (no capture, in
 * progress, generated), cards waiting, unread lines and a health dot. Agents
 * not relevant at this stage are greyed but stay clickable. One summary
 * request per expanded job.
 */
import { useEffect, useState } from 'react'
import { DOC_AGENT_LABEL } from '@/lib/agent/subagents/labels'
import { DOC_AGENT_TYPES, type DocAgentType } from '@/lib/agent/subagents/types'

type Severity = 'info' | 'warning' | 'urgent'

interface AgentRow {
  type: DocAgentType
  label: string
  doc_label: string
  state: 'missing' | 'in_progress' | 'generated'
  applicable: boolean
  pending_drafts: number
  unread: number
  health: Severity | null
  health_messages: string[]
}

interface Overview {
  file_agent: { pending_drafts: number; unread: number }
  agents: AgentRow[]
}

const STATE_LABEL: Record<AgentRow['state'], string> = { missing: 'No capture', in_progress: 'In progress', generated: 'Generated' }
const HEALTH_COLOUR: Record<Severity, string> = { info: '#94A3B8', warning: '#FBBF24', urgent: '#F87171' }

function Badge({ n }: { n: number }) {
  if (!n) return null
  return (
    <span title="Agent changes waiting" style={{ fontSize: 10, fontWeight: 800, padding: '0 5px', borderRadius: 8, background: 'var(--accent)', color: '#000', flexShrink: 0 }}>
      {n}
    </span>
  )
}

function Dot({ colour, title }: { colour: string; title: string }) {
  return <span title={title} style={{ width: 7, height: 7, borderRadius: 4, background: colour, flexShrink: 0 }} />
}

export default function JobAgentList({
  jobId,
  activeDocAgent,
  isActiveJob,
  refreshKey,
  onSelect,
}: {
  jobId: string
  /** The open agent when this is the open job: a document agent, or null for the File agent. */
  activeDocAgent: DocAgentType | null
  isActiveJob: boolean
  refreshKey: number
  onSelect: (docAgent: DocAgentType | null) => void
}) {
  const [data, setData] = useState<Overview | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const res = await fetch(`/api/agent/workspace/agents?job=${jobId}`)
      if (!res.ok || !live) return
      const next = (await res.json()) as Overview
      if (live) setData(next)
    })()
    return () => {
      live = false
    }
  }, [jobId, refreshKey])

  const rows: AgentRow[] = data?.agents ?? DOC_AGENT_TYPES.map(type => ({
    type, label: DOC_AGENT_LABEL[type].agent, doc_label: DOC_AGENT_LABEL[type].doc, state: 'missing' as const,
    applicable: true, pending_drafts: 0, unread: 0, health: null, health_messages: [],
  }))
  const rowStyle = (selected: boolean, dim: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left' as const,
    padding: '4px 12px 4px 34px', border: 'none', cursor: 'pointer', fontSize: 12,
    background: selected ? 'var(--accent-dim)' : 'transparent',
    color: selected ? 'var(--accent)' : 'var(--text)',
    opacity: dim && !selected ? 0.5 : 1,
  })

  return (
    <div role="group" aria-label="Agents on this job" style={{ paddingBottom: 4 }}>
      <button type="button" onClick={() => onSelect(null)} style={rowStyle(isActiveJob && !activeDocAgent, false)}>
        <span style={{ flex: 1, fontWeight: 600 }}>File agent</span>
        <Badge n={data?.file_agent.pending_drafts ?? 0} />
        {data?.file_agent.unread ? <Dot colour="#60A5FA" title="New activity" /> : null}
      </button>
      {rows.map(a => {
        const selected = isActiveJob && activeDocAgent === a.type
        return (
          <button
            key={a.type}
            type="button"
            onClick={() => onSelect(a.type)}
            title={[`${a.doc_label}: ${STATE_LABEL[a.state].toLowerCase()}`, ...a.health_messages].join('\n')}
            style={rowStyle(selected, !a.applicable)}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: a.unread ? 700 : 400 }}>
              {a.label.replace(/ agent$/, '')}
            </span>
            {data && (
              <span style={{ fontSize: 10, color: a.state === 'generated' ? '#4ADE80' : 'var(--text-muted)', flexShrink: 0 }}>
                {STATE_LABEL[a.state]}
              </span>
            )}
            <Badge n={a.pending_drafts} />
            {a.health ? <Dot colour={HEALTH_COLOUR[a.health]} title={a.health_messages.join('\n') || 'Needs attention'} /> : null}
            {a.unread ? <Dot colour="#60A5FA" title="New messages" /> : null}
          </button>
        )
      })}
    </div>
  )
}
