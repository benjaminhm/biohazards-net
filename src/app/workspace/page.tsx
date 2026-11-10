'use client'

/*
 * app/workspace/page.tsx
 *
 * Agent view: three panels.
 *   Left   — job list (status groups, search, unread and drafts-waiting markers)
 *   Middle — one running chat with the head agent and each job's file agent
 *   Right  — the full Classic job page (iframe), with pending agent drafts on top
 *
 * /workspace?job=<id> opens a job; &agent=<doc type> one of its document
 * agents. The Classic job page links back here via
 * the view toggle. Desktop and tablet only; staff with the full job file only
 * (the APIs enforce it).
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Job } from '@/lib/types'
import type { ChatRow } from '@/lib/agent/workspaceText'
import { isApproveAllPhrase, voiceApprovable } from '@/lib/agent/workspaceText'
import { isDocAgentType, type DocAgentType } from '@/lib/agent/subagents/types'
import { useUser } from '@/lib/userContext'
import { writeViewMode } from '@/lib/viewMode'
import ViewToggle from '@/components/workspace/ViewToggle'
import JobListPanel, { type JobMarkers } from '@/components/workspace/JobListPanel'
import ChatPanel, { type LocalLine } from '@/components/workspace/ChatPanel'
import JobPanel from '@/components/workspace/JobPanel'
import { decideDrafts, type DraftView } from '@/components/workspace/DraftList'

export default function WorkspacePage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading workspace…</div>}>
      <Workspace />
    </Suspense>
  )
}

function Workspace() {
  const router = useRouter()
  const params = useSearchParams()
  const { isAdmin, isManager, loading: userLoading } = useUser()
  const urlJob = params.get('job')
  const urlAgent = params.get('agent')

  const [jobs, setJobs] = useState<Job[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [markers, setMarkers] = useState<Record<string, JobMarkers>>({})
  const [newJobDrafts, setNewJobDrafts] = useState<DraftView[]>([])
  const [activeJobId, setActiveJobId] = useState<string | null>(urlJob)
  const [activeDocAgent, setActiveDocAgent] = useState<DocAgentType | null>(urlJob && isDocAgentType(urlAgent) ? urlAgent : null)
  const [agentsVersion, setAgentsVersion] = useState(0)
  const [rows, setRows] = useState<ChatRow[]>([])
  const [drafts, setDrafts] = useState<DraftView[]>([])
  const [localLines, setLocalLines] = useState<LocalLine[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const activeRef = useRef(activeJobId)
  activeRef.current = activeJobId
  const agentRef = useRef(activeDocAgent)
  agentRef.current = activeDocAgent

  useEffect(() => {
    writeViewMode('agent')
  }, [])

  const loadJobs = useCallback(async () => {
    const res = await fetch('/api/jobs')
    if (res.ok) setJobs((await res.json()).jobs ?? [])
    setJobsLoading(false)
  }, [])

  const loadMarkers = useCallback(async () => {
    const res = await fetch('/api/agent/workspace/summary')
    if (!res.ok) return
    const data = await res.json()
    setMarkers(data.jobs ?? {})
    setNewJobDrafts(data.new_jobs ?? [])
  }, [])

  const loadChat = useCallback(async (jobId: string | null, docAgent: DocAgentType | null = null) => {
    const res = await fetch(`/api/agent/chat${jobId ? `?job=${jobId}${docAgent ? `&agent=${docAgent}` : ''}` : ''}`)
    if (!res.ok) {
      if (res.status === 403) setError('The Agent view needs full job file access.')
      return
    }
    const data = await res.json()
    if (activeRef.current !== jobId || agentRef.current !== docAgent) return
    setAgentsVersion(v => v + 1)
    setRows(data.rows ?? [])
    setDrafts(data.drafts ?? [])
  }, [])

  const loadJob = useCallback(async (jobId: string | null) => {
    if (!jobId) {
      setJob(null)
      return
    }
    const jobRes = await fetch(`/api/jobs/${jobId}`)
    const d = jobRes.ok ? await jobRes.json() : null
    if (activeRef.current !== jobId) return
    setJob(d?.job ?? null)
    setVersion(v => v + 1)
  }, [])

  useEffect(() => {
    void loadJobs()
    void loadMarkers()
  }, [loadJobs, loadMarkers])

  useEffect(() => {
    void loadChat(activeJobId, activeDocAgent)
  }, [activeJobId, activeDocAgent, loadChat])

  useEffect(() => {
    void loadJob(activeJobId)
  }, [activeJobId, loadJob])

  const refreshAfterChange = useCallback(async () => {
    const id = activeRef.current
    await Promise.all([loadChat(id, agentRef.current), loadJob(id), loadMarkers()])
  }, [loadChat, loadJob, loadMarkers])

  async function onDraftsDecided(created: string[]) {
    if (!created.length) return refreshAfterChange()
    await loadJobs()
    void loadMarkers()
    openJob(created[0])
  }

  function workspaceUrl(id: string | null, docAgent: DocAgentType | null) {
    return id ? `/workspace?job=${id}${docAgent ? `&agent=${docAgent}` : ''}` : '/workspace'
  }

  function openJob(id: string | null, docAgent: DocAgentType | null = null) {
    const agent = id ? docAgent : null
    activeRef.current = id
    agentRef.current = agent
    setActiveJobId(id)
    setActiveDocAgent(agent)
    setLocalLines([])
    router.replace(workspaceUrl(id, agent), { scroll: false })
    if (id && !agent) setMarkers(m => (m[id] ? { ...m, [id]: { ...m[id], unread: 0 } } : m))
  }

  function addLocal(text: string) {
    setLocalLines(l => [...l, { id: `local-${Date.now()}`, text, created_at: new Date().toISOString() }])
  }

  async function onSend(text: string, viaVoice: boolean): Promise<string | null> {
    setError('')
    if (isApproveAllPhrase(text)) {
      const pending = drafts.filter(d => d.status === 'pending' && d.kind !== 'new_job' && (!activeJobId || d.job_id === activeJobId))
      if (!pending.length) {
        const msg = 'Nothing is waiting for approval here.'
        addLocal(msg)
        return msg
      }
      if (viaVoice && !voiceApprovable(pending)) {
        const msg = 'Some of these change what is on file or add a document. Check them on screen and approve there.'
        addLocal(msg)
        return msg
      }
      setBusy(true)
      try {
        const { failed } = await decideDrafts('approve', pending.map(d => d.id))
        const msg = failed.length
          ? `Approved ${pending.length - failed.length}. Not applied: ${failed.map(f => f.error).join(' ')}`
          : `Approved ${pending.length} change${pending.length === 1 ? '' : 's'}.`
        addLocal(msg)
        await refreshAfterChange()
        return msg
      } finally {
        setBusy(false)
      }
    }

    const sentAt = new Date().toISOString()
    setBusy(true)
    setRows(r => [...r, {
      id: `pending-${sentAt}`, thread_id: null, job_id: activeJobId, speaker: 'user', author: '', doc_agent: activeDocAgent, content: { text }, created_at: sentAt,
    }])
    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, active_job_id: activeJobId, active_doc_agent: activeDocAgent }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'The agent failed')
      const nextJob = (data.active_job_id as string | null) ?? null
      const nextAgent = nextJob && isDocAgentType(data.active_doc_agent) ? data.active_doc_agent : null
      if (nextJob !== activeRef.current || nextAgent !== agentRef.current) {
        const jobChanged = nextJob !== activeRef.current
        activeRef.current = nextJob
        agentRef.current = nextAgent
        setActiveJobId(nextJob)
        setActiveDocAgent(nextAgent)
        router.replace(workspaceUrl(nextJob, nextAgent), { scroll: false })
        if (!jobChanged) void loadJob(nextJob)
      } else {
        void loadJob(nextJob)
      }
      setAgentsVersion(v => v + 1)
      const newRows = (data.rows ?? []) as ChatRow[]
      setRows(newRows)
      setDrafts(data.drafts ?? [])
      void loadMarkers()
      return newRows
        .filter(r => r.created_at >= sentAt && (r.speaker === 'head_agent' || r.speaker === 'file_agent' || r.speaker === 'doc_agent'))
        .map(r => r.content?.text ?? '')
        .join(' ')
        .trim() || null
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The agent failed')
      void loadChat(activeRef.current, agentRef.current)
      return null
    } finally {
      setBusy(false)
    }
  }

  const jobRefs = useMemo(() => jobs.map(j => ({ id: j.id, job_code: j.job_code ?? null, client_name: j.client_name ?? null })), [jobs])
  const activeRefJob = activeJobId ? jobRefs.find(j => j.id === activeJobId) ?? (job ? { id: job.id, job_code: job.job_code ?? null, client_name: job.client_name } : null) : null
  const jobDrafts = drafts.filter(d => d.job_id === activeJobId)

  if (!userLoading && !(isAdmin || isManager)) {
    return (
      <div style={{ padding: 24 }}>
        The Agent view is for admins and managers. <Link href="/">Back to the dashboard</Link>
      </div>
    )
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
        <Link href="/" onClick={() => writeViewMode('classic')} style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', textDecoration: 'none' }}>
          Biohazard Cleaning QLD
        </Link>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Agent workspace</span>
        <div style={{ marginLeft: 'auto' }}>
          <ViewToggle current="agent" jobId={activeJobId} />
        </div>
      </header>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: job ? '260px minmax(0, 1fr) auto' : '260px minmax(0, 1fr)' }}>
        <JobListPanel
          jobs={jobs}
          markers={markers}
          newJobDrafts={newJobDrafts}
          onNewJobDecided={created => void onDraftsDecided(created)}
          activeJobId={activeJobId}
          activeDocAgent={activeDocAgent}
          onSelect={id => openJob(id)}
          onSelectAgent={(id, agent) => openJob(id, agent)}
          agentsRefreshKey={agentsVersion}
          loading={jobsLoading}
        />
        <ChatPanel
          rows={rows}
          localLines={localLines}
          drafts={drafts}
          jobs={jobRefs}
          activeJob={activeRefJob}
          activeDocAgent={activeDocAgent}
          busy={busy}
          error={error}
          onSend={onSend}
          onClearJob={() => openJob(null)}
          onClearDocAgent={() => openJob(activeJobId)}
          onSwitchAgent={(id, agent) => openJob(id, agent)}
          onOpenJob={id => openJob(id)}
          onDraftsDecided={created => void onDraftsDecided(created)}
        />
        {job && (
          <JobPanel
            job={job}
            drafts={jobDrafts}
            version={version}
            onDraftsDecided={() => void refreshAfterChange()}
            onEmbedChanged={() => {
              void loadJobs()
              void loadMarkers()
              void loadChat(activeRef.current, agentRef.current)
            }}
          />
        )}
      </div>
    </div>
  )
}
