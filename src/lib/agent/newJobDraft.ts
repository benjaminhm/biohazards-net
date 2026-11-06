/*
 * lib/agent/newJobDraft.ts
 *
 * The head agent's "create a job" proposal: cleaning the details it was given,
 * spotting jobs that are probably the same client or site, and the row that is
 * inserted once staff press Create. Pure, no database.
 */
import { formatToTwilioE164 } from '@/lib/phone'
import { URGENCIES } from './workspaceText'

export interface NewJobProposal {
  client_name: string
  client_phone: string
  client_email: string
  site_address: string
  job_description: string
  urgency: (typeof URGENCIES)[number]
}

export interface DuplicateCandidate {
  id: string
  job_code: string | null
  client_name: string | null
  client_phone: string | null
  client_phones?: unknown
  client_email: string | null
  site_address: string | null
  status: string | null
}

export interface PossibleDuplicate {
  id: string
  job_code: string | null
  client_name: string | null
  site_address: string | null
  status: string | null
  reasons: string[]
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/** Checks the agent's input. Throws with a plain reason. */
export function normalizeNewJob(input: Record<string, unknown>): NewJobProposal {
  const rawPhone = text(input.client_phone, 40)
  const client_phone = rawPhone ? formatToTwilioE164(rawPhone) : ''
  if (client_phone === null) throw new Error(`"${rawPhone}" is not a valid phone number`)
  const client_email = text(input.client_email, 200).toLowerCase()
  if (client_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client_email)) throw new Error(`"${client_email}" is not a valid email`)
  const rawUrgency = text(input.urgency, 20).toLowerCase() || 'standard'
  if (!(URGENCIES as readonly string[]).includes(rawUrgency)) throw new Error('urgency must be standard, urgent or emergency')
  return {
    client_name: text(input.client_name, 200),
    client_phone,
    client_email,
    site_address: text(input.site_address, 300),
    job_description: text(input.job_description, 2000),
    urgency: rawUrgency as NewJobProposal['urgency'],
  }
}

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'mx'])

export function nameTokens(name: string | null | undefined): string[] {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .replace(/['-]/g, '')
    .split(/\s+/)
    .filter(t => t && !TITLES.has(t))
}

/** Same person, allowing for order ("Smith John") and middle names. */
export function similarName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = nameTokens(a)
  const y = nameTokens(b)
  if (!x.length || !y.length) return false
  if (x.join(' ') === y.join(' ')) return x.join('').length >= 3
  if (x.length < 2 || y.length < 2) return false
  if (x[0] === y[0] && x[x.length - 1] === y[y.length - 1]) return true
  return [...x].sort().join(' ') === [...y].sort().join(' ')
}

const SUFFIXES: Record<string, string> = {
  street: 'st', road: 'rd', avenue: 'ave', av: 'ave', drive: 'dr', court: 'ct', crescent: 'cres', cr: 'cres',
  place: 'pl', parade: 'pde', terrace: 'tce', lane: 'ln', close: 'cl', boulevard: 'blvd', highway: 'hwy',
  circuit: 'cct', grove: 'gr', esplanade: 'esp', square: 'sq', way: 'way',
}
const SUFFIX_SET = new Set(Object.values(SUFFIXES))
const STATES = new Set(['qld', 'nsw', 'vic', 'sa', 'wa', 'tas', 'nt', 'act', 'australia'])

/** "Unit 3/12 Smith Street, Annerley QLD" → "3/12 smith st". Empty when there is no street number. */
export function streetKey(address: string | null | undefined): string {
  const tokens = (address ?? '')
    .toLowerCase()
    .replace(/\b(unit|u|apartment|apt|flat)\s+/g, '')
    .replace(/[^a-z0-9/\s,]/g, ' ')
    .split(/[\s,]+/)
    .filter(t => t && !STATES.has(t) && !/^\d{4}$/.test(t))
    .map(t => SUFFIXES[t] ?? t)
  const start = tokens.findIndex(t => /\d/.test(t))
  if (start < 0) return ''
  const rest = tokens.slice(start)
  const end = rest.findIndex(t => SUFFIX_SET.has(t))
  const street = end > 0 ? rest.slice(0, end + 1) : rest.slice(0, 2)
  return street.length >= 2 ? street.join(' ') : ''
}

function jobPhones(j: DuplicateCandidate): string[] {
  const extra = Array.isArray(j.client_phones)
    ? j.client_phones.map(p => (p && typeof p === 'object' ? (p as { number?: unknown }).number : null))
    : []
  return [j.client_phone, ...extra]
    .map(p => (typeof p === 'string' ? formatToTwilioE164(p) : null))
    .filter((p): p is string => Boolean(p))
}

/** Jobs that are probably the same client or site, strongest match first. */
export function findDuplicates(p: NewJobProposal, jobs: DuplicateCandidate[], max = 5): PossibleDuplicate[] {
  const street = streetKey(p.site_address)
  const scored = jobs.map(j => {
    const reasons: string[] = []
    let score = 0
    if (p.client_phone && jobPhones(j).includes(p.client_phone)) { reasons.push('same phone'); score += 3 }
    if (p.client_email && (j.client_email ?? '').trim().toLowerCase() === p.client_email) { reasons.push('same email'); score += 3 }
    if (similarName(p.client_name, j.client_name)) { reasons.push('similar client name'); score += 1 }
    if (street && streetKey(j.site_address) === street) { reasons.push('same site address'); score += 2 }
    return { j, reasons, score }
  })
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ j, reasons }) => ({
      id: j.id, job_code: j.job_code, client_name: j.client_name, site_address: j.site_address, status: j.status, reasons,
    }))
}

/** Words worth a database pre-filter: surname and street name. Letters and digits only. */
export function duplicateSearchTerms(p: NewJobProposal): { name: string; street: string } {
  const name = nameTokens(p.client_name).filter(t => t.length >= 3).pop() ?? ''
  const street = streetKey(p.site_address).split(' ').filter(t => /^[a-z]{3,}$/.test(t) && !SUFFIX_SET.has(t)).pop() ?? ''
  return { name, street }
}

/** The jobs row inserted on Create, same shape as a job made from an inbound call. */
export function newJobRow(p: NewJobProposal, jobCode: string, orgId: string) {
  return {
    job_code: jobCode,
    client_name: p.client_name,
    client_phone: p.client_phone,
    client_email: p.client_email,
    site_address: p.site_address,
    job_description: p.job_description,
    job_type: 'other',
    urgency: p.urgency,
    status: 'lead',
    notes: '',
    assessment_data: null,
    org_id: orgId,
  }
}

export function newJobLines(p: Partial<NewJobProposal>): { label: string; value: string }[] {
  return ([
    ['Client', p.client_name],
    ['Phone', p.client_phone],
    ['Email', p.client_email],
    ['Site', p.site_address],
    ['Description', p.job_description],
    ['Urgency', p.urgency && p.urgency !== 'standard' ? p.urgency : ''],
  ] as const)
    .filter(([, v]) => v)
    .map(([label, v]) => ({ label, value: String(v) }))
}

export function describeNewJob(p: NewJobProposal): string {
  const who = [p.client_name, p.site_address].filter(Boolean).join(' · ')
  return `Create a new job${who ? `: ${who}` : ' (empty)'}`
}
