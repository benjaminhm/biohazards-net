/*
 * /api/document-packs — staff send a Statement of Accounts to the client as a
 * statement pack (lib/documentPack.ts): one private link that opens on the
 * statement and links on to the other documents staff chose.
 *
 *   GET ?documentId=<statement>  what the send window needs: the job's CDRs, house
 *                                surveys and reports to choose from, the From address, the
 *                                wording to start with, and the packs already sent
 *   GET ?jobId=                  the packs sent on a job
 *   POST { statementId, documentIds, mode, toName, toEmail, subject?, message? }
 *        mode 'link'   creates the link and a passcode, and returns them with a
 *                      message for staff to paste into their own text or email
 *        mode 'email'  emails the pack from the brand address, laid out like a
 *                      Xero invoice email (lib/statementEmail.ts): balance card,
 *                      a pay button per invoice, a View link per document, and
 *                      each document attached as a PDF. Documents whose PDF
 *                      fails, or that would take the attachments past the
 *                      limit, go as links only, and the reply says which.
 *
 * The emailed link has no passcode: the email is the key, as with Xero.
 *
 * Full-access staff who are shown money only: the statement is all money. A
 * person decides what goes to the client and sends it; nothing here is sent
 * on its own (docs/ai-product-principles.md).
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { jobInOrg } from '@/lib/documentAccess'
import { getStaffFirstName } from '@/lib/clerkDisplayName'
import { seesFinancials } from '@/lib/agent/jobSnapshot'
import {
  MESSAGE_MAX,
  SIGNER_NAME_MAX,
  SUBJECT_MAX,
  cleanSignerName,
  isEmail,
  newPasscode,
  newSigningToken,
  signedDateLabel,
} from '@/lib/signing/core'
import { sendDocumentEmail } from '@/lib/signing/email'
import { documentHostStatus } from '@/lib/signing/links'
import {
  MAX_PACK_EXTRAS,
  buildPackLinks,
  packDocumentLink,
  packExpiry,
  packItemLabel,
  packLinkMessage,
  packPdfFilename,
} from '@/lib/documentPack'
import { findPackByToken, listPacks, loadPackItems, packPdfsForEmail, preparePack, removePackPdfs } from '@/lib/documentPackStore'
import { renderDocumentEmail } from '@/lib/email/documentEmail'
import { ATTACHMENT_LIMIT_BYTES, statementEmailInput, trimAttachments, uniqueFilenames } from '@/lib/statementEmail'
import type { StatementEmailItemStatus } from '@/lib/statementEmail'

// Each PDF for the email starts its own browser, one after another.
export const maxDuration = 300
const PDF_ITEM_MS = 60_000
const PDF_BUDGET_MS = 180_000

/** Names of the documents in an emailed pack, by how they went. */
interface EmailedReport {
  attached: string[]
  /** Left off so the email stays under the size limit; they are links in the email. */
  tooLarge: string[]
  /** Their PDF could not be made; they are links in the email. */
  failed: string[]
}

async function staffName(userId: string): Promise<string> {
  const name = (await getStaffFirstName(userId)).trim()
  return name === 'User' ? '' : name
}

async function guard(req: Request) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return { ok: false as const, response: g.response }
  if (!seesFinancials(g.role as Parameters<typeof seesFinancials>[0])) {
    return { ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return g
}

export async function GET(req: Request) {
  const g = await guard(req)
  if (!g.ok) return g.response
  const { supabase, orgId, userId } = g
  const params = new URL(req.url).searchParams
  const documentId = params.get('documentId')
  const jobId = params.get('jobId')

  if (documentId) {
    const prepared = await preparePack(supabase, orgId, documentId, await staffName(userId))
    if (!prepared) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    const [hostStatus, packs] = await Promise.all([
      documentHostStatus(prepared.tradingName),
      listPacks(supabase, orgId, prepared.jobId),
    ])
    return NextResponse.json({
      statement: prepared.statement,
      candidates: prepared.candidates,
      maxExtras: MAX_PACK_EXTRAS,
      attachmentLimitMb: Math.round(ATTACHMENT_LIMIT_BYTES / (1024 * 1024)),
      blockers: prepared.blockers,
      warnings: prepared.warnings,
      sender: prepared.sender,
      defaults: prepared.defaults,
      linkHost: hostStatus.liveHost,
      pendingLinkHost: hostStatus.pendingHost,
      packs,
    })
  }

  if (!jobId || !(await jobInOrg(supabase, jobId, orgId))) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  return NextResponse.json({ packs: await listPacks(supabase, orgId, jobId) })
}

export async function POST(req: Request) {
  const g = await guard(req)
  if (!g.ok) return g.response
  const { supabase, orgId, userId } = g

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const byLink = body.mode === 'link'
  const statementId = typeof body.statementId === 'string' ? body.statementId : ''
  const extraIds = Array.isArray(body.documentIds)
    ? [...new Set(body.documentIds.filter((v): v is string => typeof v === 'string' && Boolean(v) && v !== statementId))]
    : []
  const toEmail = typeof body.toEmail === 'string' ? body.toEmail.trim().toLowerCase() : ''
  const toName = cleanSignerName(body.toName)
  const subject = byLink ? '' : typeof body.subject === 'string' ? body.subject.replace(/[\r\n]+/g, ' ').trim() : ''
  const message = byLink ? '' : typeof body.message === 'string' ? body.message.trim() : ''

  if (toName.length < 2 || toName.length > SIGNER_NAME_MAX) {
    return NextResponse.json({ error: "Enter the client's name" }, { status: 400 })
  }
  if (byLink) {
    if (toEmail && !isEmail(toEmail)) {
      return NextResponse.json({ error: 'That email address does not look right. Fix it or leave it empty.' }, { status: 400 })
    }
  } else {
    if (!isEmail(toEmail)) return NextResponse.json({ error: "Enter the client's email address" }, { status: 400 })
    if (!subject || subject.length > SUBJECT_MAX) return NextResponse.json({ error: 'Enter a subject' }, { status: 400 })
    if (!message || message.length > MESSAGE_MAX) return NextResponse.json({ error: 'Enter a message' }, { status: 400 })
  }

  const sentByName = await staffName(userId)
  const prepared = await preparePack(supabase, orgId, statementId, sentByName, { extraIds, render: true })
  if (!prepared) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  if (prepared.blockers.length || !prepared.sender || !prepared.items.length) {
    return NextResponse.json({ error: prepared.blockers[0] ?? 'This statement cannot be sent yet.' }, { status: 409 })
  }
  const sender = prepared.sender

  const now = new Date()
  const expiresAt = packExpiry(now)
  const { token, hash } = newSigningToken()
  const passcode = byLink ? newPasscode() : null

  const { data: created, error: insertError } = await supabase
    .from('document_packs')
    .insert({
      org_id: orgId,
      job_id: prepared.jobId,
      document_id: prepared.statement.id,
      token_hash: hash,
      status: 'sent',
      trading_name: prepared.tradingName,
      brand_label: sender.brandLabel,
      from_address: sender.from,
      reply_to: sender.replyTo,
      to_email: toEmail || null,
      to_name: toName,
      subject,
      message,
      delivery_method: byLink ? 'link' : 'email',
      passcode,
      sent_at: now.toISOString(),
      sent_by: userId,
      sent_by_name: sentByName || null,
      expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single()
  if (insertError || !created) {
    const notMigrated = /does not exist|schema cache/i.test(insertError?.message ?? '')
    return NextResponse.json(
      { error: notMigrated ? 'Statement packs are not set up yet: migration 079 needs to be applied.' : insertError?.message ?? 'Could not save the pack' },
      { status: 500 },
    )
  }
  const packId = (created as { id: string }).id

  const { error: itemsError } = await supabase.from('document_pack_items').insert(
    prepared.items.map((item, position) => ({
      pack_id: packId,
      org_id: orgId,
      position,
      document_id: item.documentId,
      document_type: item.documentType,
      document_title: item.title,
      reference: item.reference,
      frozen_html: item.frozenHtml,
    })),
  )
  if (itemsError) {
    // Nothing has gone to the client, so leave no record.
    await supabase.from('document_packs').delete().eq('id', packId)
    return NextResponse.json({ error: `Could not save the documents (${itemsError.message}). Nothing has gone to the client.` }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'
  const hostStatus = await documentHostStatus(prepared.tradingName)
  const links = buildPackLinks(token, appUrl, hostStatus.liveHost)
  const expiresLabel = signedDateLabel(expiresAt.toISOString())

  let emailed: EmailedReport | null = null
  if (!byLink) {
    const pack = await findPackByToken(supabase, token)
    const packItems = pack ? await loadPackItems(supabase, packId) : []
    const pdfs = pack ? await packPdfsForEmail(supabase, pack, packItems, { perItemMs: PDF_ITEM_MS, budgetMs: PDF_BUDGET_MS }) : []
    const names = packItems.map(item => packItemLabel(item))
    const filenames = uniqueFilenames(packItems.map(item => packPdfFilename(item)))
    const files = packItems.flatMap((item, i) => {
      const pdf = pdfs[i]
      return pdf ? [{ index: i, size: pdf.length, keep: i === 0, filename: filenames[i], content: pdf }] : []
    })
    const { attached, tooLarge } = trimAttachments(files)
    const attachedAt = new Set(attached.map(f => f.index))
    const tooLargeAt = new Set(tooLarge.map(f => f.index))
    const status = (i: number): StatementEmailItemStatus => (attachedAt.has(i) ? 'attached' : tooLargeAt.has(i) ? 'too_large' : 'failed')
    const { html, text } = renderDocumentEmail(statementEmailInput({
      brandLabel: sender.brandLabel,
      reference: prepared.statement.reference,
      message,
      statementContent: prepared.statementContent,
      packUrl: links.page,
      items: packItems.map((_, i) => ({ name: names[i], href: packDocumentLink(links.page, i), status: status(i) })),
      expiresLabel,
      contact: prepared.contact,
    }))
    try {
      await sendDocumentEmail({
        from: sender.from,
        replyTo: sender.replyTo,
        to: toEmail,
        subject,
        html,
        text,
        attachments: attached.map(f => ({ filename: f.filename, content: f.content })),
      })
    } catch (err) {
      await supabase.from('document_packs').delete().eq('id', packId)
      if (pack) await removePackPdfs(supabase, pack, packItems.length)
      const reason = err instanceof Error ? err.message : 'send rejected'
      return NextResponse.json({ error: `The email was not sent (${reason}). Nothing has gone to the client.` }, { status: 502 })
    }
    emailed = {
      attached: packItems.flatMap((_, i) => (status(i) === 'attached' ? [names[i]] : [])),
      tooLarge: packItems.flatMap((_, i) => (status(i) === 'too_large' ? [names[i]] : [])),
      failed: packItems.flatMap((_, i) => (status(i) === 'failed' ? [names[i]] : [])),
    }
  }

  const packs = await listPacks(supabase, orgId, prepared.jobId)
  if (byLink && passcode) {
    return NextResponse.json({
      packs,
      // Shown once: only a hash of the link is kept, so it cannot be shown again.
      link: {
        url: links.page,
        host: links.host,
        pendingHost: hostStatus.pendingHost,
        passcode,
        message: packLinkMessage({
          clientName: toName,
          siteAddress: prepared.siteAddress,
          staffFirstName: sentByName,
          brandLabel: sender.brandLabel,
          link: links.page,
          passcode,
          expiresLabel,
        }),
      },
    })
  }
  return NextResponse.json({ packs, ...(emailed ? { emailed } : {}) })
}
