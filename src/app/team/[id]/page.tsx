/*
 * app/team/[id]/page.tsx
 *
 * Individual team member profile page. Combines data from two tables:
 *   - `people` (staff profile: name, phone, email, notes, emergency contact).
 *   - `org_users` via GET /api/people/[id]/access (role + capabilities).
 *
 * Sections (tabs within the page, not the job tab pattern):
 *   1. Profile — editable personal info via PATCH /api/people/[id].
 *   2. Access — role (admin/member) and per-capability toggles. Admins get
 *      ALL_CAPABILITIES automatically; members start from DEFAULT_MEMBER_CAPABILITIES
 *      merged with any saved custom capabilities from org_users.capabilities.
 *   3. Compliance Documents — licences, WHS certs, inductions, etc. Managed via
 *      GET/POST/DELETE /api/people/[id]/documents.
 *
 * CAP_GROUPS organises the TeamCapabilities keys into labelled sections (Jobs,
 * Documents, Team, SMS, Field) so the capability checkboxes are scannable.
 *
 * Admin guard: only admins can see and edit the Access section. Non-admins
 * can view their own profile but not change roles or capabilities.
 *
 * ConfirmDeleteModal guards person deletion (DELETE /api/people/[id]).
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import type { TeamCapabilities } from '@/lib/types'
import { DEFAULT_MEMBER_CAPABILITIES, DEFAULT_MANAGER_CAPABILITIES } from '@/lib/types'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal'
import { useUser } from '@/lib/userContext'

interface PersonDoc { id: string; doc_type: string; label: string; expiry_date?: string; file_url?: string }
interface InvoiceRow {
  id: string; invoice_number: string; agreed_amount: number; works_undertaken: string | null
  bank_account_name: string | null; bank_bsb: string | null; bank_account_number: string | null
  status: string; sent_at: string | null; created_at: string
  jobs: { client_name: string; site_address: string; job_type: string } | null
}
interface InvoiceForm {
  job_id: string; works_undertaken: string; agreed_amount: string
  bank_account_name: string; bank_bsb: string; bank_account_number: string
}
interface Person {
  id: string; name: string; email?: string; phone?: string
  role: string; status: string; notes?: string
  address?: string; abn?: string
  emergency_contact?: string; emergency_phone?: string
  bank_bsb?: string; bank_account_number?: string; bank_account_name?: string
  people_documents?: PersonDoc[]
}
type Access = { id: string; role: 'admin' | 'manager' | 'member'; capabilities: TeamCapabilities } | null

const DOC_TYPES = [
  { value: 'whs_cert',  label: '🦺 WHS Certificate' },
  { value: 'induction', label: '📋 Induction' },
  { value: 'nda',       label: '🔒 NDA' },
  { value: 'licence',   label: '🪪 Licence' },
  { value: 'first_aid', label: '🩺 First Aid' },
  { value: 'other',     label: '📄 Other' },
]

const CAP_GROUPS: { label: string; items: { key: keyof TeamCapabilities; label: string; sub?: string }[] }[] = [
  {
    label: 'Jobs',
    items: [
      { key: 'view_all_jobs',     label: 'View all jobs',       sub: 'Off = only their assigned jobs' },
      { key: 'create_jobs',       label: 'Create new jobs' },
      { key: 'edit_job_details',  label: 'Edit job details' },
      { key: 'change_job_status', label: 'Change job status' },
    ],
  },
  {
    label: 'Assessment',
    items: [
      { key: 'view_assessment',  label: 'View assessment' },
      { key: 'edit_assessment',  label: 'Edit & save assessment' },
      { key: 'use_smartfill',    label: 'Use SmartFill / voice' },
    ],
  },
  {
    label: 'Quote',
    items: [
      { key: 'view_quote', label: 'View quote & pricing' },
      { key: 'edit_quote', label: 'Edit quote & pricing' },
    ],
  },
  {
    label: 'Documents',
    items: [
      { key: 'generate_documents', label: 'Generate documents' },
      { key: 'edit_documents',     label: 'Edit documents' },
      { key: 'send_documents',     label: 'Send documents to clients' },
    ],
  },
  {
    label: 'Photos',
    items: [
      { key: 'upload_photos_assigned', label: 'Upload to assigned job' },
      { key: 'upload_photos_any',      label: 'Upload to any job' },
    ],
  },
  {
    label: 'Team',
    items: [
      { key: 'invite_team_members', label: 'Invite new team members' },
      { key: 'view_team_profiles',  label: 'View other team profiles' },
    ],
  },
  {
    label: 'Messaging',
    items: [{ key: 'send_sms', label: 'Send SMS to clients' }],
  },
  {
    label: 'Settings',
    items: [{ key: 'edit_settings', label: 'Edit company profile & settings' }],
  },
]

function expiryColor(date?: string) {
  if (!date) return 'var(--text-muted)'
  const now = new Date(); const exp = new Date(date)
  const soon = new Date(); soon.setDate(now.getDate() + 30)
  if (exp < now) return '#EF4444'
  if (exp < soon) return '#F59E0B'
  return '#10B981'
}
function expiryLabel(date?: string) {
  if (!date) return 'No expiry'
  const exp = new Date(date); const now = new Date()
  if (exp < now) return `Expired ${exp.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`
  const days = Math.ceil((exp.getTime() - now.getTime()) / 86400000)
  if (days <= 30) return `Expires in ${days} days`
  return exp.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}
function initials(name: string) { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) }
const AVATAR_COLORS = ['#FF6B35','#3B82F6','#8B5CF6','#10B981','#F59E0B']

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', borderRadius: 10,
  border: '1px solid var(--border)', background: 'var(--bg)',
  color: 'var(--text)', fontSize: 14, boxSizing: 'border-box',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
      {children}
    </div>
  )
}

export default function PersonPage() {
  const router = useRouter()
  const { id } = useParams() as { id: string }
  const { org } = useUser()
  const [person, setPerson] = useState<Person | null>(null)
  const [tab, setTab]       = useState<'profile' | 'access' | 'docs' | 'jobs' | 'invoices'>('profile')
  const [saving, setSaving] = useState(false)
  const [saveOk, setSaveOk] = useState(false)

  // Access state
  const [access, setAccess]           = useState<Access | null>(null)
  const [accessLoading, setAccessLoading] = useState(false)
  const [caps, setCaps]               = useState<TeamCapabilities>(DEFAULT_MEMBER_CAPABILITIES)
  const [appRole, setAppRole]         = useState<'admin' | 'manager' | 'member'>('member')
  const [savingAccess, setSavingAccess] = useState(false)
  const [accessError, setAccessError]   = useState('')
  const [accessSaved, setAccessSaved]   = useState(false)

  // Invite state
  const [inviteLink, setInviteLink]       = useState('')
  const [inviteToken, setInviteToken]     = useState('')
  const [generatingInvite, setGeneratingInvite] = useState(false)
  const [sendingEmail, setSendingEmail]   = useState(false)
  const [emailSent, setEmailSent]         = useState(false)
  const [emailError, setEmailError]       = useState('')
  const [sendingSms, setSendingSms]       = useState(false)
  const [smsSent, setSmsSent]             = useState(false)
  const [smsError, setSmsError]           = useState('')

  // Jobs tab state
  const [allJobs, setAllJobs]             = useState<{ id: string; client_name: string; site_address: string; status: string; job_type: string; scheduled_at: string | null }[]>([])
  const [assignedJobIds, setAssignedJobIds] = useState<Set<string>>(new Set())
  const [jobsLoading, setJobsLoading]     = useState(false)
  const [togglingJobId, setTogglingJobId] = useState<string | null>(null)

  // Invoice state
  const [invoices, setInvoices]           = useState<InvoiceRow[]>([])
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  const [showInvoiceForm, setShowInvoiceForm] = useState(false)
  const [invoiceForm, setInvoiceForm]     = useState<InvoiceForm>({ job_id: '', works_undertaken: '', agreed_amount: '', bank_account_name: '', bank_bsb: '', bank_account_number: '' })
  const [savingInvoice, setSavingInvoice] = useState(false)
  const [sendingInvoiceId, setSendingInvoiceId] = useState<string | null>(null)
  const [sentInvoiceIds, setSentInvoiceIds]   = useState<Set<string>>(new Set())

  // Doc state
  const [showAddDoc, setShowAddDoc] = useState(false)
  const [docForm, setDocForm]       = useState({ doc_type: 'whs_cert', label: '', expiry_date: '' })
  const [addingDoc, setAddingDoc]   = useState(false)
  const [deleting, setDeleting]     = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/people/${id}`)
    const data = await res.json()
    if (data.person) setPerson(data.person)
  }, [id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (tab !== 'access') return
    setAccessLoading(true)
    fetch(`/api/people/${id}/access`)
      .then(r => r.json())
      .then(d => {
        setAccess(d.access)
        if (d.access) {
          setAppRole(d.access.role)
          const base = d.access.role === 'manager' ? DEFAULT_MANAGER_CAPABILITIES : DEFAULT_MEMBER_CAPABILITIES
          setCaps({ ...base, ...(d.access.capabilities ?? {}) })
        }
      })
      .finally(() => setAccessLoading(false))
  }, [tab, id])

  // Load all active jobs + this person's assignments when Jobs tab opens
  useEffect(() => {
    if ((tab !== 'jobs' && tab !== 'invoices') || !person) return
    setJobsLoading(true)
    const ACTIVE = ['lead','assessed','quoted','accepted','scheduled','underway']
    fetch('/api/jobs')
      .then(r => r.json())
      .then(async d => {
        const active = (d.jobs ?? []).filter((j: { status: string }) => ACTIVE.includes(j.status))
        setAllJobs(active)
        // For each job, check if this person is assigned
        const assigned = new Set<string>()
        await Promise.all(active.map(async (j: { id: string }) => {
          const res = await fetch(`/api/jobs/${j.id}/team`)
          const td = await res.json()
          const isAssigned = (td.assignments ?? []).some((a: { people: { id: string } }) => a.people?.id === person.id)
          if (isAssigned) assigned.add(j.id)
        }))
        setAssignedJobIds(assigned)
      })
      .finally(() => setJobsLoading(false))
  }, [tab, person])

  useEffect(() => {
    if (tab !== 'invoices') return
    setInvoicesLoading(true)
    fetch(`/api/people/${id}/invoices`)
      .then(r => r.json())
      .then(d => setInvoices(d.invoices ?? []))
      .finally(() => setInvoicesLoading(false))
  }, [tab, id])

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault()
    if (!invoiceForm.agreed_amount) return
    setSavingInvoice(true)
    try {
      const res = await fetch(`/api/people/${id}/invoices`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...invoiceForm, agreed_amount: parseFloat(invoiceForm.agreed_amount) }),
      })
      const d = await res.json()
      if (res.ok) {
        setInvoices(prev => [d.invoice, ...prev])
        setShowInvoiceForm(false)
        setInvoiceForm({ job_id: '', works_undertaken: '', agreed_amount: '', bank_account_name: '', bank_bsb: '', bank_account_number: '' })
      }
    } finally { setSavingInvoice(false) }
  }

  async function sendInvoice(invoiceId: string) {
    setSendingInvoiceId(invoiceId)
    try {
      const res = await fetch(`/api/people/${id}/invoices/${invoiceId}/send`, { method: 'POST' })
      if (res.ok) {
        setSentInvoiceIds(prev => new Set([...prev, invoiceId]))
        setInvoices(prev => prev.map(inv => inv.id === invoiceId ? { ...inv, status: 'sent' } : inv))
      }
    } finally { setSendingInvoiceId(null) }
  }

  async function toggleJobAssignment(jobId: string) {
    if (!person) return
    setTogglingJobId(jobId)
    const isAssigned = assignedJobIds.has(jobId)
    try {
      await fetch(`/api/jobs/${jobId}/team`, {
        method: isAssigned ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: person.id }),
      })
      setAssignedJobIds(prev => {
        const next = new Set(prev)
        isAssigned ? next.delete(jobId) : next.add(jobId)
        return next
      })
    } finally { setTogglingJobId(null) }
  }

  function updateField(key: keyof Person, val: string) {
    setPerson(p => p ? { ...p, [key]: val } : p)
  }

  function toggleCap(key: keyof TeamCapabilities) {
    if (key === 'assign_team_members') return // handled separately
    setCaps(c => ({ ...c, [key]: !c[key] }))
  }

  async function save() {
    if (!person) return
    setSaving(true)
    const { id: _id, people_documents: _docs, ...fields } = person
    await fetch(`/api/people/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) })
    setSaving(false); setSaveOk(true); setTimeout(() => setSaveOk(false), 2000)
  }

  async function saveAccess() {
    setSavingAccess(true)
    setAccessError('')
    const res = await fetch(`/api/people/${id}/access`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: appRole, capabilities: caps }),
    })
    const data = await res.json()
    if (data.error) {
      setAccessError(data.error)
    } else {
      setAccess(data.access)
      setAccessSaved(true)
      setTimeout(() => setAccessSaved(false), 2000)
    }
    setSavingAccess(false)
  }

  async function addDoc() {
    if (!docForm.label.trim()) return
    setAddingDoc(true)
    const res = await fetch(`/api/people/${id}/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(docForm) })
    const data = await res.json()
    if (data.document) {
      setPerson(p => p ? { ...p, people_documents: [...(p.people_documents ?? []), data.document] } : p)
      setShowAddDoc(false); setDocForm({ doc_type: 'whs_cert', label: '', expiry_date: '' })
    }
    setAddingDoc(false)
  }

  async function deleteDoc(docId: string) {
    setPerson(p => p ? { ...p, people_documents: p.people_documents?.filter(d => d.id !== docId) } : p)
    await fetch(`/api/people/${id}/documents`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId }) })
  }

  async function deletePerson() {
    setDeleting(true)
    await fetch(`/api/people/${id}`, { method: 'DELETE' })
    router.push('/team')
  }

  async function generateInvite() {
    if (!person) return
    setGeneratingInvite(true)
    const res = await fetch('/api/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member', person_id: person.id }),
    })
    const data = await res.json()
    if (data.token) {
      const url = `${window.location.origin}/invite/${data.token}`
      const firstName = person.name.split(' ')[0]
      const company = org?.name ?? 'the team'
      setInviteToken(data.token)
      setInviteLink(
        `Hi ${firstName}, you've been invited to join the ${company} app. Please click the link below to sign in and get started.\n\n${url}\n\nThanks,\n${company} Administrator`
      )
    }
    setGeneratingInvite(false)
  }

  if (!person) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>Loading…</div>
  )

  const avatarColor = AVATAR_COLORS[person.name.charCodeAt(0) % AVATAR_COLORS.length]
  const docs = person.people_documents ?? []

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 80 }}>

      {/* Top bar */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, position: 'sticky', top: 0, zIndex: 20 }}>
        <button onClick={() => router.push('/team')} style={{ fontSize: 20, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 4px' }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{person.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{person.role}</div>
        </div>
        {saveOk && <span style={{ fontSize: 12, color: '#4ADE80' }}>✓ Saved</span>}
        {tab === 'profile' && (
          <button onClick={save} disabled={saving} style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>
            {saving ? '…' : '💾 Save'}
          </button>
        )}
      </div>

      {/* Avatar hero */}
      <div style={{ background: 'var(--surface)', padding: '20px 20px 0', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 22, flexShrink: 0 }}>
            {initials(person.name)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{person.name}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{person.phone}{person.phone && person.email ? ' · ' : ''}{person.email}</div>
          </div>
          <button onClick={() => updateField('status', person.status === 'active' ? 'inactive' : 'active')}
            style={{ padding: '7px 14px', borderRadius: 20, border: 'none', fontWeight: 600, fontSize: 12, cursor: 'pointer', flexShrink: 0,
              background: person.status === 'active' ? '#10B98120' : '#EF444420',
              color: person.status === 'active' ? '#10B981' : '#EF4444' }}>
            {person.status === 'active' ? '● Active' : '○ Inactive'}
          </button>
        </div>
        {/* Quick actions */}
        <div style={{ display: 'flex', gap: 8, paddingBottom: 16 }}>
          {person.phone && (
            <a href={`tel:${person.phone}`}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 6px', borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--text)' }}>
              <span style={{ fontSize: 18 }}>📞</span>
              <span style={{ fontSize: 11, fontWeight: 600 }}>Call</span>
            </a>
          )}
          {person.phone && (
            <a href={`sms:${person.phone}`}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 6px', borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--text)' }}>
              <span style={{ fontSize: 18 }}>💬</span>
              <span style={{ fontSize: 11, fontWeight: 600 }}>Message</span>
            </a>
          )}
          {person.email && (
            <a href={`mailto:${person.email}`}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 6px', borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--text)' }}>
              <span style={{ fontSize: 18 }}>✉️</span>
              <span style={{ fontSize: 11, fontWeight: 600 }}>Email</span>
            </a>
          )}
          <button
            onClick={() => {
              const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${person.name}`]
              if (person.phone) lines.push(`TEL:${person.phone}`)
              if (person.email) lines.push(`EMAIL:${person.email}`)
              lines.push('END:VCARD')
              const blob = new Blob([lines.join('\n')], { type: 'text/vcard' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url; a.download = `${person.name}.vcf`; a.click()
              URL.revokeObjectURL(url)
            }}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 6px', borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text)' }}>
            <span style={{ fontSize: 18 }}>👤</span>
            <span style={{ fontSize: 11, fontWeight: 600 }}>Save</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-slider" style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        {([
          { id: 'profile',  label: '👤 Profile' },
          { id: 'access',   label: '🔐 App Access' },
          { id: 'docs',     label: `📋 Docs${docs.length ? ` (${docs.length})` : ''}` },
          { id: 'jobs',     label: '🔧 Jobs' },
          { id: 'invoices', label: `🧾 Invoices${invoices.length ? ` (${invoices.length})` : ''}` },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flexShrink: 0, padding: '13px 18px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              color: tab === t.id ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent' }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '20px 16px' }}>

        {/* ── Profile ── */}
        {tab === 'profile' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Full Name">
              <input value={person.name} onChange={e => updateField('name', e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Employment Type">
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { value: 'employee',      label: '👷 Employee',      color: '#3B82F6' },
                  { value: 'subcontractor', label: '🔧 Subcontractor', color: '#8B5CF6' },
                ].map(r => (
                  <button key={r.value} onClick={() => updateField('role', r.value)}
                    style={{ flex: 1, padding: '10px', borderRadius: 8, border: `2px solid ${person.role === r.value ? r.color : 'var(--border)'}`, background: person.role === r.value ? r.color : 'var(--bg)', color: person.role === r.value ? '#fff' : 'var(--text)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                    {r.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Phone">
              <input value={person.phone ?? ''} onChange={e => updateField('phone', e.target.value)} type="tel" style={inputStyle} />
            </Field>
            <Field label="Email">
              <input value={person.email ?? ''} onChange={e => updateField('email', e.target.value)} type="email" style={inputStyle} />
            </Field>
            <Field label="Address">
              <input value={person.address ?? ''} onChange={e => updateField('address', e.target.value)} placeholder="Home or postal address" style={inputStyle} />
            </Field>
            <Field label="ABN">
              <input value={person.abn ?? ''} onChange={e => updateField('abn', e.target.value)} placeholder="XX XXX XXX XXX" style={inputStyle} />
            </Field>
            <Field label="Emergency Contact">
              <input value={person.emergency_contact ?? ''} onChange={e => updateField('emergency_contact', e.target.value)} placeholder="Contact name" style={inputStyle} />
            </Field>
            <Field label="Emergency Phone">
              <input value={person.emergency_phone ?? ''} onChange={e => updateField('emergency_phone', e.target.value)} type="tel" style={inputStyle} />
            </Field>
            <Field label="Notes">
              <textarea value={person.notes ?? ''} onChange={e => updateField('notes', e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
            </Field>
            <div style={{ marginTop: 12, padding: '16px', borderRadius: 12, border: '1px solid #EF444440', background: '#EF444408' }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#EF4444', marginBottom: 8 }}>Danger Zone</div>
              <button onClick={() => setShowDeleteModal(true)}
                style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #EF4444', background: 'none', color: '#EF4444', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                🗑 Delete Profile
              </button>
            </div>
          </div>
        )}

        {/* ── App Access ── */}
        {tab === 'access' && (
          <div>
            {accessLoading && <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>Loading…</div>}

            {!accessLoading && !access && (
              <div style={{ padding: '40px 0 20px' }}>
                <div style={{ textAlign: 'center', marginBottom: 28 }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📵</div>
                  <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)', marginBottom: 8 }}>Not linked to an app account</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
                    Send {person.name.split(' ')[0]} an invite link so they can sign in and claim this profile.
                  </div>
                  {!inviteLink && (
                    <button
                      onClick={generateInvite}
                      disabled={generatingInvite}
                      style={{ padding: '12px 28px', borderRadius: 10, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: generatingInvite ? 0.6 : 1 }}
                    >
                      {generatingInvite ? 'Generating…' : '📨 Generate Invite Link'}
                    </button>
                  )}
                </div>
                {inviteLink && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
                      Copy and send this message:
                    </div>
                    <div
                      style={{
                        background: '#fff', color: '#111', padding: '16px', borderRadius: 10,
                        fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                        border: '1px solid #ddd', userSelect: 'text', cursor: 'text',
                      }}
                    >
                      {inviteLink}
                    </div>

                    {emailError && (
                      <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#F87171', fontSize: 12 }}>
                        {emailError}
                      </div>
                    )}
                    {smsError && (
                      <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#F87171', fontSize: 12 }}>
                        {smsError}
                      </div>
                    )}

                    <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button
                        onClick={() => navigator.clipboard.writeText(inviteLink)}
                        style={{ flex: '1 1 120px', padding: '11px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
                      >
                        📋 Copy
                      </button>
                      {person.email && inviteToken && (
                        <button
                          onClick={async () => {
                            setSendingEmail(true)
                            setEmailError('')
                            setEmailSent(false)
                            const res = await fetch('/api/invites/send-email', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ token: inviteToken }),
                            })
                            const data = await res.json().catch(() => ({}))
                            if (!res.ok) {
                              setEmailError(typeof data.error === 'string' ? data.error : 'Send failed')
                            } else {
                              setEmailSent(true)
                              setTimeout(() => setEmailSent(false), 4000)
                            }
                            setSendingEmail(false)
                          }}
                          disabled={sendingEmail || emailSent}
                          style={{
                            flex: '1 1 120px',
                            padding: '11px',
                            borderRadius: 10,
                            border: 'none',
                            background: emailSent ? '#10B981' : 'var(--accent)',
                            color: '#fff',
                            fontWeight: 600,
                            fontSize: 13,
                            cursor: 'pointer',
                            opacity: sendingEmail ? 0.6 : 1,
                          }}
                        >
                          {sendingEmail ? 'Sending…' : emailSent ? '✓ Email sent' : '✉️ Send email'}
                        </button>
                      )}
                      {person.phone && (
                        <button
                          onClick={async () => {
                            setSendingSms(true)
                            setSmsError('')
                            setSmsSent(false)
                            const res = await fetch('/api/sms/direct', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ to_number: person.phone, body: inviteLink }),
                            })
                            const data = await res.json()
                            if (data.error) {
                              setSmsError(data.error)
                            } else {
                              setSmsSent(true)
                              setTimeout(() => setSmsSent(false), 3000)
                            }
                            setSendingSms(false)
                          }}
                          disabled={sendingSms || smsSent}
                          style={{ flex: '1 1 120px', padding: '11px', borderRadius: 10, border: 'none', background: smsSent ? '#10B981' : 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: sendingSms ? 0.6 : 1 }}
                        >
                          {sendingSms ? 'Sending…' : smsSent ? '✓ Sent!' : '📱 Send SMS'}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setInviteLink('')
                          setInviteToken('')
                          setSmsSent(false)
                          setSmsError('')
                          setEmailSent(false)
                          setEmailError('')
                          generateInvite()
                        }}
                        style={{ flex: '1 1 120px', padding: '11px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
                      >
                        🔄 New
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!accessLoading && access && (
              <>
                {/* Three-tier role selector */}
                <div style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 12 }}>
                    Position
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {([
                      {
                        value: 'member',
                        label: '👷 Team Member',
                        sub: 'Field worker — sees only their assigned jobs. No client contact info.',
                        color: '#3B82F6',
                      },
                      {
                        value: 'manager',
                        label: '🗂 Manager',
                        sub: 'Oversees jobs and team. Sees client details. No billing or settings.',
                        color: '#8B5CF6',
                      },
                      {
                        value: 'admin',
                        label: '🛡 Administrator',
                        sub: 'Full access to everything including settings and pricing.',
                        color: '#FF6B35',
                      },
                    ] as const).map(r => (
                      <button
                        key={r.value}
                        onClick={() => {
                          setAppRole(r.value)
                          // Pre-load default caps when switching tier
                          if (r.value === 'manager') setCaps({ ...DEFAULT_MANAGER_CAPABILITIES, ...(access?.capabilities ?? {}) })
                          if (r.value === 'member')  setCaps({ ...DEFAULT_MEMBER_CAPABILITIES,  ...(access?.capabilities ?? {}) })
                        }}
                        style={{
                          padding: '14px 16px', borderRadius: 12, textAlign: 'left', width: '100%',
                          border: `2px solid ${appRole === r.value ? r.color : 'var(--border)'}`,
                          background: appRole === r.value ? `${r.color}12` : 'var(--bg)',
                          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                        }}>
                        <div style={{
                          width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                          border: `2px solid ${appRole === r.value ? r.color : 'var(--border)'}`,
                          background: appRole === r.value ? r.color : 'transparent',
                        }} />
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: appRole === r.value ? r.color : 'var(--text)' }}>{r.label}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{r.sub}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                  {appRole === 'admin' && (
                    <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,107,53,0.06)', border: '1px solid rgba(255,107,53,0.2)', fontSize: 12, color: 'var(--accent)' }}>
                      Administrators have full access. Another admin must exist before removing this one.
                    </div>
                  )}
                </div>

                {/* Assign team members + capability toggles — shown for member and manager */}
                {(appRole === 'member' || appRole === 'manager') && (
                  <>
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 12 }}>
                        Assign Team Members
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {([
                          { value: 'none', label: 'No access',             sub: 'Cannot assign anyone' },
                          { value: 'own',  label: 'Own assignments only',  sub: 'Can assign on jobs they are part of' },
                          { value: 'all',  label: 'All jobs',              sub: 'Full visibility — manager level' },
                        ] as const).map(o => (
                          <button key={o.value}
                            onClick={() => setCaps(c => ({ ...c, assign_team_members: o.value }))}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 12,
                              padding: '12px 14px', borderRadius: 10, textAlign: 'left',
                              border: `2px solid ${caps.assign_team_members === o.value ? 'var(--accent)' : 'var(--border)'}`,
                              background: caps.assign_team_members === o.value ? 'rgba(255,107,53,0.08)' : 'var(--bg)',
                              cursor: 'pointer', width: '100%',
                            }}>
                            <div style={{
                              width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                              border: `2px solid ${caps.assign_team_members === o.value ? 'var(--accent)' : 'var(--border)'}`,
                              background: caps.assign_team_members === o.value ? 'var(--accent)' : 'transparent',
                            }} />
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13, color: caps.assign_team_members === o.value ? 'var(--accent)' : 'var(--text)' }}>{o.label}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{o.sub}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Capability toggles */}
                    {CAP_GROUPS.map(group => (
                      <div key={group.label} style={{ marginBottom: 24 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 10 }}>
                          {group.label}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {group.items.map(item => {
                            const isOn = !!caps[item.key]
                            return (
                              <button key={item.key} onClick={() => toggleCap(item.key)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 14,
                                  padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)',
                                  background: isOn ? 'rgba(255,107,53,0.06)' : 'var(--bg)',
                                  cursor: 'pointer', textAlign: 'left', width: '100%',
                                }}>
                                {/* Toggle pill */}
                                <div style={{
                                  width: 40, height: 22, borderRadius: 11, flexShrink: 0,
                                  background: isOn ? 'var(--accent)' : 'var(--border)',
                                  position: 'relative', transition: 'background 0.2s',
                                }}>
                                  <div style={{
                                    position: 'absolute', top: 3, left: isOn ? 21 : 3,
                                    width: 16, height: 16, borderRadius: '50%', background: '#fff',
                                    transition: 'left 0.2s',
                                  }} />
                                </div>
                                <div>
                                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{item.label}</div>
                                  {item.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{item.sub}</div>}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {accessError && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#F87171', fontSize: 13, marginBottom: 16 }}>
                    {accessError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <a
                    href={`/field/preview/${id}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ flex: 1, padding: 14, borderRadius: 10, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', fontWeight: 600, fontSize: 14, cursor: 'pointer', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    👁 Preview ↗
                  </a>
                  <button onClick={saveAccess} disabled={savingAccess}
                    style={{ flex: 2, padding: 14, borderRadius: 10, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 15, cursor: 'pointer', opacity: savingAccess ? 0.6 : 1 }}>
                    {savingAccess ? 'Saving…' : accessSaved ? '✓ Saved' : 'Save'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Documents ── */}
        {tab === 'docs' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <button onClick={() => setShowAddDoc(true)}
                style={{ padding: '9px 16px', borderRadius: 10, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                + Add Document
              </button>
            </div>
            {docs.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>No documents yet</div>
                <div style={{ fontSize: 13 }}>Add WHS certificates, inductions, licences and more.</div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {docs.map(doc => {
                const color = expiryColor(doc.expiry_date)
                const typeLabel = DOC_TYPES.find(t => t.value === doc.doc_type)?.label ?? doc.doc_type
                return (
                  <div key={doc.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{doc.label || typeLabel}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{typeLabel}</div>
                      <div style={{ fontSize: 12, color, marginTop: 4, fontWeight: 600 }}>{expiryLabel(doc.expiry_date)}</div>
                    </div>
                    {doc.file_url && <a href={doc.file_url} target="_blank" rel="noreferrer" style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>View</a>}
                    <button onClick={() => deleteDoc(doc.id)} style={{ padding: '6px 10px', borderRadius: 6, border: 'none', background: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 16 }}>🗑</button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Jobs ── */}
        {tab === 'jobs' && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
              Toggle to assign or remove {person?.name.split(' ')[0]} from any active job. Changes reflect immediately in their app view.
            </div>

            {jobsLoading ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                <div className="spinner" />
              </div>
            ) : allJobs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🔧</div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>No active jobs</div>
                <div style={{ fontSize: 13 }}>Create a job first to assign team members.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {allJobs.map(job => {
                  const assigned = assignedJobIds.has(job.id)
                  const toggling = togglingJobId === job.id
                  return (
                    <div key={job.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '14px 16px', borderRadius: 12,
                      background: assigned ? 'rgba(34,197,94,0.06)' : 'var(--surface)',
                      border: `1px solid ${assigned ? 'rgba(34,197,94,0.2)' : 'var(--border)'}`,
                      transition: 'all 0.15s',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
                          {job.client_name}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {job.site_address}
                        </div>
                        {job.scheduled_at && (
                          <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 3, fontWeight: 600 }}>
                            {new Date(job.scheduled_at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => toggleJobAssignment(job.id)}
                        disabled={toggling}
                        style={{
                          flexShrink: 0,
                          width: 52, height: 28, borderRadius: 99,
                          background: assigned ? '#22C55E' : 'var(--surface-2)',
                          border: `1px solid ${assigned ? '#22C55E' : 'var(--border-2)'}`,
                          cursor: toggling ? 'not-allowed' : 'pointer',
                          position: 'relative', transition: 'all 0.2s',
                          opacity: toggling ? 0.6 : 1,
                        }}
                      >
                        <div style={{
                          position: 'absolute', top: 3,
                          left: assigned ? 26 : 3,
                          width: 20, height: 20, borderRadius: 99,
                          background: '#fff',
                          transition: 'left 0.2s',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                        }} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Invoices ── */}
        {tab === 'invoices' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Subcontractor invoices sent to accounts</div>
              <button
                onClick={() => setShowInvoiceForm(v => !v)}
                style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                {showInvoiceForm ? 'Cancel' : '+ New Invoice'}
              </button>
            </div>

            {/* New invoice form */}
            {showInvoiceForm && (
              <form onSubmit={createInvoice} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 2 }}>Job Details</div>
                <Field label="Linked Job (optional)">
                  <select value={invoiceForm.job_id} onChange={e => setInvoiceForm(f => ({ ...f, job_id: e.target.value }))} style={inputStyle}>
                    <option value="">— No specific job —</option>
                    {allJobs.filter(j => assignedJobIds.has(j.id)).map(j => (
                      <option key={j.id} value={j.id}>{j.client_name} · {j.site_address}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Works Undertaken">
                  <textarea
                    value={invoiceForm.works_undertaken}
                    onChange={e => setInvoiceForm(f => ({ ...f, works_undertaken: e.target.value }))}
                    placeholder="Describe the work completed…"
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical' }}
                  />
                </Field>
                <Field label="Agreed Amount ($)">
                  <input
                    type="number" step="0.01" min="0" required
                    value={invoiceForm.agreed_amount}
                    onChange={e => setInvoiceForm(f => ({ ...f, agreed_amount: e.target.value }))}
                    placeholder="0.00"
                    style={inputStyle}
                  />
                </Field>
                <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 2 }}>Bank Details</div>
                <Field label="Account Name">
                  <input value={invoiceForm.bank_account_name} onChange={e => setInvoiceForm(f => ({ ...f, bank_account_name: e.target.value }))} placeholder="Name on account" style={inputStyle} />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="BSB">
                    <input value={invoiceForm.bank_bsb} onChange={e => setInvoiceForm(f => ({ ...f, bank_bsb: e.target.value }))} placeholder="000-000" style={inputStyle} />
                  </Field>
                  <Field label="Account Number">
                    <input value={invoiceForm.bank_account_number} onChange={e => setInvoiceForm(f => ({ ...f, bank_account_number: e.target.value }))} placeholder="12345678" style={inputStyle} />
                  </Field>
                </div>
                <button type="submit" disabled={savingInvoice} style={{ padding: '12px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: savingInvoice ? 0.6 : 1, marginTop: 4 }}>
                  {savingInvoice ? 'Saving…' : 'Save Invoice'}
                </button>
              </form>
            )}

            {/* Invoice list */}
            {invoicesLoading ? (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}><span className="spinner" /></div>
            ) : invoices.length === 0 && !showInvoiceForm ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>No invoices yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {invoices.map(inv => {
                  const job = Array.isArray(inv.jobs) ? (inv.jobs as unknown as { client_name: string; site_address: string }[])[0] : inv.jobs
                  const isSent = inv.status === 'sent' || sentInvoiceIds.has(inv.id)
                  const isSending = sendingInvoiceId === inv.id
                  return (
                    <div key={inv.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: job || inv.works_undertaken ? 10 : 0 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15 }}>{inv.invoice_number}</div>
                          {job && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{job.client_name} · {job.site_address}</div>}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--accent)' }}>
                            ${Number(inv.agreed_amount).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                            {new Date(inv.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </div>
                        </div>
                      </div>
                      {inv.works_undertaken && (
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>{inv.works_undertaken}</div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: isSent ? 'rgba(34,197,94,0.1)' : 'rgba(100,100,100,0.1)', color: isSent ? '#4ADE80' : '#888' }}>
                          {isSent ? `✓ Sent${inv.sent_at ? ' · ' + new Date(inv.sent_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : ''}` : 'Draft'}
                        </span>
                        {!isSent && (
                          <button
                            onClick={() => sendInvoice(inv.id)}
                            disabled={isSending}
                            style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', opacity: isSending ? 0.6 : 1 }}
                          >
                            {isSending ? '…' : '✉ Send to Accounts'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete person modal */}
      {showDeleteModal && person && (
        <ConfirmDeleteModal
          title={`Delete ${person.name}?`}
          description="This will permanently remove their profile and all associated documents. This cannot be undone."
          confirmName={person.name}
          onConfirm={deletePerson}
          onCancel={() => setShowDeleteModal(false)}
        />
      )}

      {/* Add document modal */}
      {showAddDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: 500 }}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>Add Document</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <select value={docForm.doc_type} onChange={e => setDocForm(f => ({ ...f, doc_type: e.target.value }))}
                style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14 }}>
                {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input value={docForm.label} onChange={e => setDocForm(f => ({ ...f, label: e.target.value }))} placeholder="Label (e.g. Asbestos Awareness 2025) *"
                style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14 }} />
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Expiry date</label>
                <input type="date" value={docForm.expiry_date} onChange={e => setDocForm(f => ({ ...f, expiry_date: e.target.value }))}
                  style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14, width: '100%', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowAddDoc(false)} style={{ flex: 1, padding: '13px', borderRadius: 10, border: '1px solid var(--border)', background: 'none', color: 'var(--text)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={addDoc} disabled={addingDoc || !docForm.label.trim()} style={{ flex: 2, padding: '13px', borderRadius: 10, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: addingDoc || !docForm.label.trim() ? 0.5 : 1 }}>
                {addingDoc ? 'Adding…' : 'Add Document'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
