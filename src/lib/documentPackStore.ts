/*
 * lib/documentPackStore.ts
 *
 * The database side of statement packs (lib/documentPack.ts): what can go in
 * one, the documents frozen as sent, finding a pack from its link, and the
 * PDF of each document (made on the first download and kept).
 */
import type { createServiceClient } from '@/lib/supabase'
import { documentInOrg } from '@/lib/documentAccess'
import { renderDocumentHtml } from '@/lib/documentRender'
import { isTradingNameId, tradingNameShortList } from '@/lib/tradingNames'
import type { TradingNameId } from '@/lib/tradingNames'
import { hashSigningTokenSafe, resolveSender } from '@/lib/signing/core'
import type { ResolvedSender } from '@/lib/signing/core'
import { renderPdf } from '@/lib/signing/pdf'
import { SIGNED_BUCKET } from '@/lib/signing/store'
import {
  MAX_PACK_EXTRAS,
  PACK_EXTRA_TYPES,
  PACK_STATEMENT_TYPE,
  orderPackExtras,
  packDefaultMessage,
  packDefaultSubject,
  packDocumentTitle,
} from '@/lib/documentPack'

type ServiceClient = ReturnType<typeof createServiceClient>

export interface PackRow {
  id: string
  org_id: string
  job_id: string
  document_id: string | null
  status: 'sent' | 'viewed' | 'voided'
  trading_name: string | null
  brand_label: string
  from_address: string
  reply_to: string | null
  to_email: string | null
  to_name: string
  delivery_method: 'email' | 'link'
  passcode: string | null
  passcode_attempts: number
  passcode_verified_at: string | null
  passcode_locked_at: string | null
  sent_at: string
  sent_by_name: string | null
  expires_at: string
  first_viewed_at: string | null
  last_viewed_at: string | null
  voided_at: string | null
}

export interface PackItemRow {
  id: string
  position: number
  document_id: string | null
  document_type: string
  document_title: string
  reference: string | null
  pdf_path: string | null
}

const PACK_COLUMNS =
  'id, org_id, job_id, document_id, status, trading_name, brand_label, from_address, reply_to, to_email, to_name, delivery_method, passcode, passcode_attempts, passcode_verified_at, passcode_locked_at, sent_at, sent_by_name, expires_at, first_viewed_at, last_viewed_at, voided_at'
const ITEM_COLUMNS = 'id, position, document_id, document_type, document_title, reference, pdf_path'

/** A document on the job that can go in the pack with the statement. */
export interface PackCandidate {
  id: string
  type: string
  title: string
  reference: string | null
  created_at: string
}

export interface PreparedPackItem {
  documentId: string
  documentType: string
  title: string
  reference: string | null
  frozenHtml: string
}

export interface PreparedPack {
  jobId: string
  statement: PackCandidate
  /** The job's CDRs and reports, newest first within each type. */
  candidates: PackCandidate[]
  tradingName: TradingNameId | null
  siteAddress: string | null
  sender: ResolvedSender | null
  blockers: string[]
  defaults: { toEmail: string; toName: string; subject: string; message: string }
  /** Statement first. Only filled when asked to render (on send). */
  items: PreparedPackItem[]
}

function referenceOf(content: unknown): string | null {
  const ref = (content as { reference?: unknown } | null)?.reference
  return typeof ref === 'string' && ref.trim() ? ref.trim() : null
}

type DocRow = { id: string; job_id: string; type: string; content: Record<string, unknown> | null; created_at: string }

function candidateOf(doc: DocRow): PackCandidate {
  return { id: doc.id, type: doc.type, title: packDocumentTitle(doc.type), reference: referenceOf(doc.content), created_at: doc.created_at }
}

/**
 * Everything about sending a statement pack. With `extraIds` and `render`,
 * each chosen document is rendered as the client will see it; nothing from the
 * browser is trusted for what a document says. Null when the statement does
 * not exist or belongs to another organisation.
 */
export async function preparePack(
  supabase: ServiceClient,
  orgId: string,
  statementId: string,
  staffFirstName: string,
  options: { extraIds?: string[]; render?: boolean } = {},
): Promise<PreparedPack | null> {
  if (!(await documentInOrg(supabase, statementId, orgId))) return null
  const { data: doc } = await supabase
    .from('documents')
    .select('id, job_id, type, content, created_at')
    .eq('id', statementId)
    .maybeSingle()
  if (!doc) return null
  const statementDoc = doc as DocRow

  const [jobRes, companyRes, othersRes] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, client_name, client_email, site_address, trading_name')
      .eq('id', statementDoc.job_id)
      .eq('org_id', orgId)
      .maybeSingle(),
    supabase.from('company_profile').select('email').eq('org_id', orgId).limit(1).maybeSingle(),
    supabase
      .from('documents')
      .select('id, job_id, type, content, created_at')
      .eq('job_id', statementDoc.job_id)
      .in('type', [...PACK_EXTRA_TYPES])
      .order('created_at', { ascending: false }),
  ])
  const job = jobRes.data
  if (!job) return null

  const blockers: string[] = []
  if (statementDoc.type !== PACK_STATEMENT_TYPE) blockers.push('Only a Statement of Accounts can be sent as a pack.')
  const tradingName = isTradingNameId(job.trading_name) ? job.trading_name : null
  if (!tradingName) {
    blockers.push(`Choose the trading name on the job first (${tradingNameShortList()}), so the statement goes out under the right brand.`)
  }
  const sender = tradingName
    ? resolveSender(
        tradingName,
        { RESEND_FROM_ACCOUNTS: process.env.RESEND_FROM_ACCOUNTS, RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL },
        (companyRes.data as { email?: string | null } | null)?.email,
      )
    : null

  const otherDocs = (othersRes.data ?? []) as DocRow[]
  const candidates = orderPackExtras(otherDocs.map(d => d.id), otherDocs.map(candidateOf))
  const statement = candidateOf(statementDoc)
  const clientName = ((job.client_name as string | null) ?? '').trim()
  const siteAddress = ((job.site_address as string | null) ?? '').trim() || null
  const brandLabel = sender?.brandLabel ?? ''

  const items: PreparedPackItem[] = []
  if (options.render && !blockers.length) {
    const chosen = orderPackExtras(options.extraIds ?? [], candidates)
    if (new Set(options.extraIds ?? []).size > MAX_PACK_EXTRAS) {
      blockers.push(`A pack can carry the statement and up to ${MAX_PACK_EXTRAS} other documents.`)
    } else if (chosen.length !== new Set(options.extraIds ?? []).size) {
      blockers.push('One of the documents chosen is no longer on this job. Close the window and try again.')
    } else {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'
      const docsById = new Map(otherDocs.map(d => [d.id, d]))
      const inOrder = [statementDoc, ...chosen.map(c => docsById.get(c.id) as DocRow)]
      const rendered = await Promise.all(
        inOrder.map(d =>
          renderDocumentHtml({
            supabase,
            doc: d,
            imagesParam: null,
            viewerUrl: `${appUrl}/api/print/${d.id}`,
            includeClientContact: true,
            forSigning: true,
          }),
        ),
      )
      inOrder.forEach((d, i) => {
        const c = candidateOf(d)
        if (!rendered[i]?.trim()) blockers.push(`${c.title} could not be prepared.`)
        items.push({ documentId: d.id, documentType: d.type, title: c.title, reference: c.reference, frozenHtml: rendered[i] ?? '' })
      })
    }
  }

  return {
    jobId: job.id as string,
    statement,
    candidates,
    tradingName,
    siteAddress,
    sender,
    blockers,
    defaults: {
      toEmail: ((job.client_email as string | null) ?? '').trim(),
      toName: clientName,
      subject: packDefaultSubject(brandLabel || 'us', statement.reference),
      message: packDefaultMessage({ clientName, siteAddress, staffFirstName, brandLabel }),
    },
    items,
  }
}

export async function findPackByToken(supabase: ServiceClient, token: string): Promise<PackRow | null> {
  const hash = hashSigningTokenSafe(token)
  if (!hash) return null
  const { data } = await supabase.from('document_packs').select(PACK_COLUMNS).eq('token_hash', hash).maybeSingle()
  return (data as PackRow | null) ?? null
}

export async function loadPackItems(supabase: ServiceClient, packId: string): Promise<PackItemRow[]> {
  const { data } = await supabase
    .from('document_pack_items')
    .select(ITEM_COLUMNS)
    .eq('pack_id', packId)
    .order('position', { ascending: true })
  return (data ?? []) as PackItemRow[]
}

export async function loadPackItemHtml(supabase: ServiceClient, item: PackItemRow): Promise<string> {
  const { data, error } = await supabase.from('document_pack_items').select('frozen_html').eq('id', item.id).single()
  if (error || !data) throw new Error(error?.message ?? 'Document not found')
  return (data as { frozen_html: string }).frozen_html
}

/** The PDF of one document in the pack: made the first time it is asked for, then kept. */
export async function ensurePackPdf(supabase: ServiceClient, pack: PackRow, item: PackItemRow): Promise<Buffer> {
  if (item.pdf_path) {
    const { data } = await supabase.storage.from(SIGNED_BUCKET).download(item.pdf_path)
    if (data) return Buffer.from(await data.arrayBuffer())
  }
  const pdf = await renderPdf(await loadPackItemHtml(supabase, item))
  const path = `${pack.org_id}/${pack.job_id}/packs/${pack.id}-${item.position + 1}.pdf`
  const { error } = await supabase.storage.from(SIGNED_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (error) {
    console.error('[pack] storing PDF failed', pack.id, error.message)
  } else if (item.pdf_path !== path) {
    await supabase.from('document_pack_items').update({ pdf_path: path }).eq('id', item.id)
  }
  return pdf
}

/** What the staff list shows for a pack. The passcode is shown to staff so they can give it again. */
export interface PackSummary {
  id: string
  document_id: string | null
  status: PackRow['status']
  to_name: string
  to_email: string | null
  delivery_method: PackRow['delivery_method']
  passcode: string | null
  passcode_locked_at: string | null
  sent_at: string
  sent_by_name: string | null
  expires_at: string
  first_viewed_at: string | null
  last_viewed_at: string | null
  voided_at: string | null
  items: { position: number; document_title: string; reference: string | null }[]
}

export async function listPacks(supabase: ServiceClient, orgId: string, jobId: string): Promise<PackSummary[]> {
  const { data } = await supabase
    .from('document_packs')
    .select(PACK_COLUMNS)
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .order('sent_at', { ascending: false })
    .limit(50)
  const packs = (data ?? []) as PackRow[]
  if (!packs.length) return []
  const { data: itemRows } = await supabase
    .from('document_pack_items')
    .select('pack_id, position, document_title, reference')
    .in('pack_id', packs.map(p => p.id))
    .order('position', { ascending: true })
  const byPack = new Map<string, PackSummary['items']>()
  for (const i of (itemRows ?? []) as { pack_id: string; position: number; document_title: string; reference: string | null }[]) {
    const list = byPack.get(i.pack_id) ?? []
    list.push({ position: i.position, document_title: i.document_title, reference: i.reference })
    byPack.set(i.pack_id, list)
  }
  return packs.map(p => ({
    id: p.id,
    document_id: p.document_id,
    status: p.status,
    to_name: p.to_name,
    to_email: p.to_email,
    delivery_method: p.delivery_method,
    passcode: p.passcode,
    passcode_locked_at: p.passcode_locked_at,
    sent_at: p.sent_at,
    sent_by_name: p.sent_by_name,
    expires_at: p.expires_at,
    first_viewed_at: p.first_viewed_at,
    last_viewed_at: p.last_viewed_at,
    voided_at: p.voided_at,
    items: byPack.get(p.id) ?? [],
  }))
}
