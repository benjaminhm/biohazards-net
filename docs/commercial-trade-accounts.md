# Commercial trade accounts — architecture and setup

Reference for humans and agents. The trade account portal is served from
`accounts.<brand>.com.au` and lets a commercial client accept standing Terms &
Conditions once, then approve quotes with a single click and download completion
reports for their own jobs.

Schema: `supabase-migration-047-commercial-accounts.sql`.

## Why this is separate from Clerk

Clerk is **staff** authentication. A trade contact is a client, not a team member:
putting them in Clerk would add monthly-active-user cost for people who sign in a
handful of times a year, and would make an accidental role escalation possible.

Portal auth is therefore its own thing:

| Concern | Staff | Trade contact |
|---|---|---|
| Identity | Clerk user → `org_users` | `client_account_contacts` row |
| Login | Clerk session | Single-use emailed link → `bh_portal` cookie |
| Cookie scope | `.biohazards.net` and satellites | Host-only on the accounts host |
| Query scoping | `org_id` (`lib/org.ts`) | `org_id` **and** `client_account_id` (`lib/portalScope.ts`) |

The root layout (`src/app/layout.tsx`) branches on `x-subdomain: accounts` and
renders a shell **without** `ClerkProvider`. This is load-bearing, not cosmetic:
Clerk production keys throw on a host that is neither the primary domain nor a
configured satellite.

## Request flow

1. `src/middleware.ts` matches the host against `accountsHost` in
   `src/lib/tradingNames.ts`, sets `x-subdomain: accounts` and
   `x-portal-trading-name`, and 404s anything outside `/portal` and `/api/portal`.
   It deliberately does **not** set `x-org-host`, which would send the host into
   `getOrgId`'s `orgs.custom_domain` lookup.
2. The org comes from `ACCOUNTS_PORTAL_ORG_SLUG` (`src/lib/portalTenant.ts`).
3. Every `/api/portal/*` route starts with `requirePortalContext(req)`, which
   re-reads account and contact status from the database on each request, so
   suspending an account revokes an unexpired 30-day session immediately.

## What a client can see

Nothing by default. Two explicit staff actions open the gate:

- **`jobs.client_account_id`** — set from the job file (Client Details → Trade
  account). Without it, a job is invisible to every portal user.
- **`documents.released_to_portal_at`** — the "Visible in client's trade account
  portal" checkbox on each saved document (Docs → History). Drafts stay internal
  even on a linked job.

Documents are served through `/api/portal/documents/[id]`, which requires a portal
session, rather than the public `/api/print/[docId]`. Both share one renderer
(`src/lib/documentRender.ts`) so output is identical.

> **Known gap, pre-existing:** `/api/print/[docId]` is public with no token, so
> anyone holding a document UUID can read it. The portal avoids it; staff email
> and copy-link flows still depend on it. Closing that is separate work.

## Terms & Conditions versioning

`src/lib/portal/terms.ts` holds the wording and `CURRENT` version string per brand.
Accounts store only the version they accepted, and **git history is the record of
what each version said**.

Never edit a published version in place. Add a new version string: every account
then reads as "terms out of date" and is prompted to re-accept before approving
another quote. Jobs already accepted stay under the version in force at the time,
which is why `quote_acceptances.terms_version` is copied onto each acceptance.

## The trade account application

A new account's details are gathered from the client rather than re-keyed by
staff. Migration 048 adds the entity, director, accounts-payable, payment and
two trade-reference columns to `client_accounts`, and the portal's Company
profile page is the form for them.

The state machine is one column, `application_submitted_at`:

- **Null** — the client edits freely. `PATCH /api/portal/company` accepts writes,
  the form shows what is still blank, and **Submit for review** is disabled until
  the required set (`REQUIRED_APPLICATION_FIELDS` in
  `src/lib/portal/application.ts`) is answered.
- **Set** — `POST /api/portal/company/submit` stamped it along with the contact
  who pressed the button, emailed `ACCOUNTS_EMAIL`, and the portal is read-only.
  Both the check and the update are guarded with `.is('application_submitted_at',
  null)`, so a double click cannot rewrite who submitted.
- **Reopened** — `POST /api/accounts/[id]/reopen` clears it and stamps
  `application_reopened_at`. Only staff can unlock, because staff may be part way
  through a credit check against exactly those values.

Which fields exist, which are required and how they group is defined once in
`src/lib/portal/application.ts` and shared by the portal form, the submit
endpoint and the staff review card — a client being told they are done while
staff see gaps is the failure mode that module exists to prevent.

Staff can still correct a typo directly (the columns are in
`EDITABLE_ACCOUNT_FIELDS`) without bouncing the whole form back. Submitting does
not gate anything else: an account can accept quotes with the application half
finished, since the credit check informs terms rather than blocking work.

## Why acceptances survive deletion

`quote_acceptances` is the evidence a named person committed their company to a
priced scope of work, so it must outlive the records it references. `contact_id`,
`job_id` and `document_id` are nullable and `ON DELETE SET NULL`, not `CASCADE` —
staff can hard-delete a document from the Docs tab, and cascading would quietly
destroy the proof that the work was authorised.

That is also why `contact_name`, `contact_email`, `quote_reference`, `quote_total`
and `terms_version` are denormalised onto the row rather than joined: an orphaned
acceptance is still complete evidence on its own. Portal queries filter out rows
whose `document_id` has gone null, since there is nothing left to link to.

## Setup runbook

Steps 1–2 are code-side and already done. Steps 3–6 need Vercel, registrar and
Resend access.

### 1. Database

Run `supabase-migration-047-commercial-accounts.sql`, then
`supabase-migration-048-account-application.sql`, in the Supabase SQL editor.
Both are safe to re-run. 048 only adds nullable columns, so the SQL editor's
"destructive operations" warning on it is a false positive from keyword scanning.

### 2. Environment variables

Set in Vercel (Production and Preview) and in local `.env.local` — see
`.env.local.example`:

| Variable | Purpose |
|---|---|
| `PORTAL_SESSION_SECRET` | Signs the `bh_portal` cookie. Min 32 chars: `openssl rand -base64 32`. The portal throws without it. |
| `ACCOUNTS_PORTAL_ORG_SLUG` | `orgs.slug` owning the trade accounts, e.g. `brisbanebiohazardcleaning`. Portal returns 404 without it. |
| `RESEND_FROM_ACCOUNTS` | Overrides the brand sender. Set it to an address on an already-verified domain while a brand domain is pending, and **unset it once that domain verifies**. |
| `ACCOUNTS_EMAIL` | Receives the staff alerts when a quote is accepted and when an account application is submitted. Falls back to `NOTIFY_EMAIL`. |
| `ACCOUNTS_PORTAL_DEV_TRADING_NAME` | Local dev only — which brand `/portal` renders on localhost. |

There is no `NEXT_PUBLIC_ACCOUNTS_URL`: the portal URL is derived per brand from
`accountsHost` in `src/lib/tradingNames.ts`, so adding a second brand's portal is
a one-line change rather than another environment variable.

### 3. Vercel domain

Add `accounts.forensiccleaningqld.com.au` to the project:

```bash
vercel domains add accounts.forensiccleaningqld.com.au
# or: Project → Settings → Domains → Add
```

### 4. DNS

**Check who is actually authoritative first.** `forensiccleaningqld.com.au` is
delegated to Netlify DNS (NS1 nameservers), while SiteGround also holds a stale
zone for it. Edits in SiteGround do nothing. Confirm before touching anything:

```bash
dig +short SOA forensiccleaningqld.com.au   # → dns1.p01.nsone.net. domains+netlify.netlify.com.
```

Add the record in the **Netlify DNS zone editor**, not in a Netlify *site's*
domain settings — attaching the hostname to a site makes Netlify point it at its
own edge and serve the marketing site instead.

Do not take Vercel's warning text at face value for the record value; it still
advertises the legacy `76.76.21.21`, which no longer serves. Ask for the current
target instead:

```bash
vercel domains verify accounts.forensiccleaningqld.com.au
```

and use the rank-1 entry from `recommended.records` — a per-project CNAME such as
`accounts → cbb6e84a31ed568d.vercel-dns-017.com.`. Prefer the CNAME over an A
record so Vercel can renumber without another DNS change.

Never switch nameservers to Vercel: the zone also carries the apex website and
the Google Workspace MX, and both would go dark until rebuilt.

Wait for Vercel to report the domain as Valid before inviting anyone.

### 5. Resend sending domain

Verify `forensiccleaningqld.com.au` in Resend so magic links send from
`admin@forensiccleaningqld.com.au` (the address in `TRADING_NAME_OPTIONS`). Add the
DKIM and SPF records Resend provides. Deliverability of a login link matters more
than usual — it is the only way in.

**Until the domain shows Verified, every portal email is rejected**, because
Resend refuses any send from an unverified domain. Set `RESEND_FROM_ACCOUNTS` to
an address on a domain that is already verified to keep invites working in the
meantime, and remove it afterwards.

Resend's SDK returns failures in the response rather than throwing, so
`lib/portal/email.ts` checks the returned `error` and throws. Without that the
invite route reports success on a rejected send — if portal email ever goes
quiet, that check is the thing to confirm is still in place.

Note the domain currently publishes **no live SPF or DMARC**: both records exist
only in the stale SiteGround zone, so receivers see nothing. Recreate them in the
Netlify zone alongside Resend's records rather than copying the SiteGround SPF,
which references a `dnssmarthost.net` include that may no longer reflect how mail
is sent.

### 6. Smoke test

1. Staff: Dashboard → **Trade Accounts** → create an account under Forensic
   Cleaning QLD → add yourself as a contact → **Send invite**.
2. Open the emailed link, press **Continue**, accept the terms.
3. Client: **Company profile** → fill the four sections → **Submit for review**.
   Confirm the form goes read-only, the alert reaches `ACCOUNTS_EMAIL`, and the
   account shows **Awaiting review** in Trade Accounts. **Reopen for editing** on
   the account page should unlock it again.
4. Staff: open a job, set its trade account, release a quote document to the portal.
5. Client: the quote appears under "Awaiting your approval"; approve it and confirm
   the job moves to `accepted` and the alert reaches `ACCOUNTS_EMAIL`.

## Adding another brand's portal

1. Add `accountsHost` to that brand's entry in `src/lib/tradingNames.ts`.
2. Repeat steps 3–5 for the new host and domain.

Terms are generated per brand automatically, and the middleware match is
data-driven, so no other code changes are needed.

## Deliberate omissions in v1

- **No self-registration.** Staff create accounts; there is no public sign-up, so
  an unknown email can never attach itself to a company's job history.
- **No invoices.** There is no `customer_invoices` table in this app, so the portal
  shows quotes and completion documents only.
- **No client-managed contacts.** Adding or removing who can sign in stays with
  staff, since it controls who can commit the account to spend.
- **No document uploads on the application.** Insurance certificates and the like
  are still emailed; storing client-supplied files needs a retention answer first.
