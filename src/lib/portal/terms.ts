/*
 * lib/portal/terms.ts
 *
 * Standing Terms & Conditions for commercial trade accounts.
 *
 * An account accepts these once. Every later quote is then accepted with a
 * single authenticated click, because the master agreement is already in place —
 * that is what a trade account buys the client over the handwritten
 * Authorisation to Proceed on a printed quote.
 *
 * The text lives in the repo rather than the database on purpose: git history is
 * the record of exactly what wording an account agreed to. Accounts store only
 * the version string. Never edit a published version in place — add a new one,
 * which flips every account to "terms out of date" and prompts re-acceptance.
 */
import { TRADING_NAME_OPTIONS } from '@/lib/tradingNames'
import type { TradingNameId } from '@/lib/tradingNames'

export interface PortalTermsVersion {
  /** Immutable identifier stored on client_accounts.terms_version. */
  version: string
  publishedAt: string
  title: string
  html: string
}

function termsHtml(brandLabel: string, brandEmail: string): string {
  return `
<h2>1. These terms</h2>
<p>These Terms &amp; Conditions govern all work performed by ${brandLabel} ("we", "us") for the
account holder named on this account ("you"). They apply to every job we carry out for you from the
date you accept them, and continue until replaced by a newer published version.</p>
<p>Each quote you accept forms a separate contract for that job, incorporating these terms. Where a
quote and these terms conflict, the quote prevails for that job only.</p>

<h2>2. Quotes, acceptance and authority</h2>
<p>Quotes are valid for the period stated on the quote. Accepting a quote through this accounts area
is your authority for us to attend the site and carry out the scoped work, and has the same effect as
a signed authorisation.</p>
<p>You confirm that any person you allow to accept quotes on this account is authorised to commit your
organisation to the amounts involved. You can restrict which of your contacts may accept quotes by
asking us to change their access.</p>
<p>Where a quote is issued as an estimate, the scope is priced on the information available at the
time. If conditions on site differ materially, we will contact you before continuing and issue a
variation for approval.</p>

<h2>3. Site access and site conditions</h2>
<p>You are responsible for arranging safe and lawful access to the site at the agreed time, including
keys, access codes, parking and any building or body corporate approvals. Where we attend and cannot
gain access, or the site is not ready, a call-out fee may apply.</p>
<p>You must tell us anything you know about the site that affects safety or scope, including known
infectious disease risk, asbestos, structural damage, firearms or sharps, pets, and occupants who
should not be present during the work.</p>

<h2>4. Hazardous work and clearance</h2>
<p>Our work involves biological and chemical hazards and is performed under our own safe work method
statements. During remediation, only our personnel and people we authorise may enter the work area.</p>
<p>Where a job includes post-remediation verification, the clearance we issue relates only to the
areas and surfaces stated in the scope, assessed on the day of inspection. It is not a warranty
against later recontamination or against conditions in areas outside the scope.</p>

<h2>5. Contents and disposal</h2>
<p>Items identified as unsalvageable in the scope are disposed of as regulated waste and cannot be
recovered afterwards. If you want particular items retained or attempted for salvage, you must tell us
in writing before work starts.</p>
<p>Unless the quote says otherwise, disposal of contaminated waste is included in the scoped price for
the volumes quoted. Additional volume is charged as a variation.</p>

<h2>6. Variations</h2>
<p>Work outside the accepted scope is only performed once you approve a variation. Where a genuine
health or safety risk requires immediate action, we may act first and notify you as soon as
practicable, charging at our standard rates.</p>

<h2>7. Invoicing and payment</h2>
<p>Unless a written credit arrangement is in place for this account, invoices are payable on the terms
stated on the quote or invoice. Amounts are in Australian dollars and, where applicable, include GST.</p>
<p>Overdue accounts may be placed on hold, and we may decline to schedule further work until the
account is brought up to date. Reasonable costs of recovering an overdue amount are payable by you.</p>

<h2>8. Cancellation and rescheduling</h2>
<p>You may reschedule a booked job by giving us reasonable notice. Where a job is cancelled or
rescheduled at short notice, we may charge for mobilisation, consumables already committed, and
labour we cannot reallocate.</p>

<h2>9. Confidentiality and privacy</h2>
<p>The nature of our work means we frequently attend sensitive incidents. We treat the circumstances
of every job as confidential and will not identify a site, occupant or incident publicly.</p>
<p>We keep job records, including photographs, as evidence of the work performed and to meet our
regulatory obligations. Photographs are used for reporting and quality assurance, and are not used
for marketing without your written consent.</p>

<h2>10. Liability</h2>
<p>Nothing in these terms excludes rights you have under the Australian Consumer Law. Subject to
that, our liability for any job is limited to re-performing the affected work or refunding the amount
paid for it, and we are not liable for indirect or consequential loss, including loss of rent,
revenue or profit.</p>
<p>We are not responsible for pre-existing damage, for wear revealed once contamination is removed,
or for the condition of items we have advised are unsalvageable.</p>

<h2>11. Account access</h2>
<p>Access to this accounts area is by single-use link sent to a nominated contact's email address.
You must tell us promptly when a contact leaves your organisation so we can remove their access. You
are responsible for activity carried out through your contacts' access.</p>

<h2>12. Changes to these terms</h2>
<p>We may publish a new version of these terms. If we do, you will be asked to review and accept the
new version the next time you sign in. Jobs already accepted continue under the version in force when
they were accepted.</p>

<h2>13. Governing law</h2>
<p>These terms are governed by the laws of Queensland, Australia, and the courts of that State have
jurisdiction.</p>

<h2>14. Questions</h2>
<p>If anything here is unclear, or you need terms tailored to your organisation's procurement
requirements, contact us at ${brandEmail} before accepting.</p>
`.trim()
}

/**
 * Current published terms per brand. Bump `version` (and never edit existing
 * wording) when the agreement changes.
 */
export const PORTAL_TERMS: Record<TradingNameId, PortalTermsVersion> = Object.fromEntries(
  TRADING_NAME_OPTIONS.map(option => [
    option.id,
    {
      version: '2026-07-01',
      publishedAt: '2026-07-01',
      title: `${option.label} — Trade Account Terms & Conditions`,
      html: termsHtml(option.label, option.email ?? 'admin@brisbanebiohazardcleaning.com.au'),
    },
  ])
) as Record<TradingNameId, PortalTermsVersion>

export function portalTermsFor(tradingName: TradingNameId): PortalTermsVersion {
  return PORTAL_TERMS[tradingName]
}

/** True when the account has accepted the version currently published. */
export function areTermsCurrent(
  tradingName: TradingNameId,
  acceptedVersion: string | null | undefined
): boolean {
  return !!acceptedVersion && acceptedVersion === PORTAL_TERMS[tradingName].version
}
