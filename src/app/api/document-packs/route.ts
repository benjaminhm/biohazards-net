/*
 * /api/document-packs — staff send a Statement of Accounts to the client as a
 * statement pack (lib/documentPack.ts): one private link that opens on the
 * statement and links on to the CDR and report staff chose.
 *
 *   GET ?documentId=<statement>  what the send window needs: the job's CDRs and
 *                                reports to choose from, the From address, the
 *                                wording to start with, and the packs already sent
 *   GET ?jobId=                  the packs sent on a job
 *   POST { statementId, documentIds, mode, toName, toEmail, subject?, message? }
 *        mode 'link'   creates the link and a passcode, and returns them with a
 *                      message for staff to paste into their own text or email
 *        mode 'email'  emails the link from the brand address
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
import { sendSigningInviteEmail } from '@/lib/signing/email'
import { documentHostStatus } from '@/lib/signing/links'
import { MAX_PACK_EXTRAS, buildPackLinks, packExpiry, packItemLabel, packLinkMessage } from '@/lib/documentPack'
import { listPacks, preparePack } from '@/lib/documentPackStore'

export const maxDuration = 60

async function staffName(userId: string): Promise<string> {
  const name = (await getStaffFirstName(userId)).trim()
  return name === 'User' ? '' : name
}

function listLine(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
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
      blockers: prepared.blockers,
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

  if (!byLink) {
    try {
      await sendSigningInviteEmail({
        from: sender.from,
        replyTo: sender.replyTo,
        to: toEmail,
        subject,
        message,
        brandLabel: sender.brandLabel,
        documentLine: listLine(prepared.items.map(i => packItemLabel({ document_title: i.title, reference: i.reference }))),
        signUrl: links.page,
        expiresLabel,
      })
    } catch (err) {
      await supabase.from('document_packs').delete().eq('id', packId)
      const reason = err instanceof Error ? err.message : 'send rejected'
      return NextResponse.json({ error: `The email was not sent (${reason}). Nothing has gone to the client.` }, { status: 502 })
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
  return NextResponse.json({ packs })
}
