/*
 * lib/signing/prepare.ts
 *
 * Works out everything about sending one saved quote for signing: whether it
 * can go at all, which brand address it goes from, the document exactly as the
 * client will sign it, and the wording the send window starts with.
 *
 * Used twice with the same answer both times: to fill the send window, and
 * again when staff press Send (nothing from the browser is trusted for who the
 * email is from or what the document says).
 */
import type { createServiceClient } from '@/lib/supabase'
import { isAcceptableQuoteType } from '@/lib/acceptableQuotes'
import { documentInOrg } from '@/lib/documentAccess'
import { renderDocumentHtml } from '@/lib/documentRender'
import { isTradingNameId } from '@/lib/tradingNames'
import type { TradingNameId } from '@/lib/tradingNames'
import { DOC_TYPE_LABELS } from '@/lib/types'
import type { DocType } from '@/lib/types'
import { defaultMessage, defaultSubject, resolveSender } from '@/lib/signing/core'
import type { ResolvedSender } from '@/lib/signing/core'
import { hasSignSlots } from '@/lib/signing/slots'

type ServiceClient = ReturnType<typeof createServiceClient>

export interface PreparedSigning {
  documentId: string
  documentType: string
  jobId: string
  title: string
  reference: string | null
  total: number | null
  tradingName: TradingNameId | null
  /** Null when the job has no trading name yet. */
  sender: ResolvedSender | null
  frozenHtml: string
  /** Reasons this cannot be sent. Empty when it can. */
  blockers: string[]
  defaults: { toEmail: string; toName: string; subject: string; message: string }
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** The heading printed at the top of the document (e.g. "Trauma Cleaning"), taken from the rendered page. */
function titleFromHtml(html: string, fallback: string): string {
  const match = /class="sow-doc-title">([^<]*)</.exec(html)
  const title = match ? unescapeHtml(match[1]).trim() : ''
  return title || fallback
}

/** Null when the document does not exist or belongs to another organisation. */
export async function prepareSigning(
  supabase: ServiceClient,
  orgId: string,
  documentId: string,
  staffFirstName: string,
): Promise<PreparedSigning | null> {
  if (!(await documentInOrg(supabase, documentId, orgId))) return null

  const { data: doc } = await supabase
    .from('documents')
    .select('id, job_id, type, content')
    .eq('id', documentId)
    .maybeSingle()
  if (!doc) return null

  const [jobRes, companyRes, acceptanceRes] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, org_id, client_name, client_email, site_address, trading_name')
      .eq('id', doc.job_id)
      .eq('org_id', orgId)
      .maybeSingle(),
    supabase.from('company_profile').select('email').limit(1).maybeSingle(),
    supabase.from('quote_acceptances').select('accepted_at').eq('document_id', documentId).maybeSingle(),
  ])
  const job = jobRes.data
  if (!job) return null

  const blockers: string[] = []
  const acceptable = isAcceptableQuoteType(doc.type)
  if (!acceptable) blockers.push('Only quotes can be sent for signing.')
  if (acceptanceRes.data) blockers.push('This quote has already been accepted.')

  const tradingName = isTradingNameId(job.trading_name) ? job.trading_name : null
  if (!tradingName) {
    blockers.push('Choose the trading name on the job first (BCQ, FCQ or HCQ), so the quote goes out under the right brand.')
  }
  const sender = tradingName
    ? resolveSender(
        tradingName,
        { RESEND_FROM_ACCOUNTS: process.env.RESEND_FROM_ACCOUNTS, RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL },
        (companyRes.data as { email?: string | null } | null)?.email,
      )
    : null

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'
  const frozenHtml = acceptable
    ? await renderDocumentHtml({
        supabase,
        doc: doc as { id: string; job_id: string; type: string; content: Record<string, unknown> | null },
        imagesParam: null,
        viewerUrl: `${appUrl}/api/print/${documentId}`,
        includeClientContact: true,
        forSigning: true,
      })
    : ''
  if (acceptable && !hasSignSlots(frozenHtml)) {
    blockers.push('This document could not be prepared for signing.')
  }

  const content = (doc.content ?? {}) as Record<string, unknown>
  const reference = typeof content.reference === 'string' && content.reference.trim() ? content.reference.trim() : null
  const total = typeof content.total === 'number' ? content.total : null
  const title = titleFromHtml(frozenHtml, DOC_TYPE_LABELS[doc.type as DocType] ?? 'Quote')
  const clientName = ((job.client_name as string | null) ?? '').trim()
  const brandLabel = sender?.brandLabel ?? ''

  return {
    documentId,
    documentType: doc.type as string,
    jobId: job.id as string,
    title,
    reference,
    total,
    tradingName,
    sender,
    frozenHtml,
    blockers,
    defaults: {
      toEmail: ((job.client_email as string | null) ?? '').trim(),
      toName: clientName,
      subject: defaultSubject(brandLabel || 'us', title, reference),
      message: defaultMessage({
        clientName,
        title,
        siteAddress: (job.site_address as string | null) ?? null,
        staffFirstName,
        brandLabel,
      }),
    },
  }
}
