import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircle2,
  ClipboardCheck,
  Lock,
  Mail,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { hazmatHref } from "@/components/hazmat-site/paths";
import { getHazmatBasePath } from "@/components/hazmat-site/serverPath";

export const metadata: Metadata = {
  title: "Independent Operators",
  description:
    "Onboarding requirements, compliance verification, direct Xero invoicing privacy boundaries, and commercial ring-fencing for independent specialist remediation operators.",
};

const ONBOARDING_CHECKLIST = [
  {
    code: "REQ-01",
    title: "Incorporated Entity & ABN / ACN Verification",
    detail:
      "Active Australian Business Number (ABN), legal company name, trading name (if applicable), GST registration status, and authorised representative details.",
  },
  {
    code: "REQ-02",
    title: "Public Liability Insurance (Expiry-Tracked)",
    detail:
      "Current Certificate of Currency covering the specialist remediation or trade activities performed, with policy number, insurer, coverage limit, and expiry date verified prior to allocation.",
  },
  {
    code: "REQ-03",
    title: "Workers Compensation / WorkCover Currency",
    detail:
      "Current state-applicable Workers Compensation / WorkCover certificate (e.g. WorkCover Queensland) or statutory sole-director confirmation where applicable.",
  },
  {
    code: "REQ-04",
    title: "Trade, Hazmat, Asbestos & EPA Licences",
    detail:
      "Copies of applicable statutory licences, regulated waste transport approvals, QBCC / trade licences, and IICRC or specialist remediation certifications relevant to the operator's discipline.",
  },
  {
    code: "REQ-05",
    title: "Current High-Risk Safe Work Method Statements (SWMS)",
    detail:
      "Documented WHS / SWMS procedures covering biological hazards, PPE/RPE, decontamination controls, sharps handling, chemical exposure, and regulated waste segregation.",
  },
  {
    code: "REQ-06",
    title: "Independent Operator Platform Deed",
    detail:
      "Electronic execution of the Independent Operator Platform Deed confirming legal independence, direct client contracting, non-partnership status, insurance maintenance, and commercial confidentiality.",
  },
];

const XERO_PERMITTED = [
  "Create or match the client contact record for an approved Co-Bid scope",
  "Issue draft or authorised deposit and balance tax invoices in your own Xero organisation",
  "Retrieve the direct Xero Online Invoice payment URL to display on your client document",
  "Poll invoice payment status (paid / awaiting payment) for that specific Co-Bid invoice ID only",
];

const XERO_EXCLUDED = [
  "No access to bank feeds, bank statements, or reconciliation accounts",
  "No access to payroll, employee records, or superannuation",
  "No access to Profit & Loss, Balance Sheet, BAS, or management reports",
  "No access to supplier bills, purchase orders, or unrelated non-platform client invoices",
];

export default async function HazmatOperatorsPage() {
  const basePath = await getHazmatBasePath();

  return (
    <div>
      {/* Header */}
      <section className="hazmat-grid-bg border-b border-slate-200 bg-[#F8FAFC]">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-teal-700">
            Operator Standards &middot; DOC-REF HM-OPCO-01
          </p>
          <h1 className="mt-2 max-w-3xl text-[30px] font-semibold leading-tight tracking-tight text-[#0F172A] sm:text-[38px]">
            For independent specialist operators
          </h1>
          <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-slate-600">
            Participation on the HAZMAT Management coordination platform is by
            invitation and compliance approval. Operators retain full commercial
            autonomy, direct client contracts, and direct invoicing.
          </p>
        </div>
      </section>

      {/* Mandatory Onboarding Hoops */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div className="max-w-2xl">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
                Pre-Allocation Verification
              </p>
              <h2 className="mt-1.5 text-[24px] font-semibold tracking-tight text-[#0F172A] sm:text-[28px]">
                Mandatory onboarding &amp; compliance checklist
              </h2>
              <p className="mt-2 text-[14.5px] text-slate-600">
                Invited operators complete a 5-step digital onboarding workflow
                at{" "}
                <span className="font-mono text-[13px] text-slate-800">
                  app.hazmatmanagement.com.au/onboard/&lt;token&gt;
                </span>
                . Approval is granted only after coordinator review of uploaded
                documentation.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-amber-200 bg-amber-50 px-3 py-1.5 font-mono text-[11px] font-medium text-amber-800">
              <ClipboardCheck className="h-3.5 w-3.5" />
              <span>EXPIRY-GATED ALLOCATION</span>
            </span>
          </div>

          <div className="mt-9 grid gap-4 md:grid-cols-2">
            {ONBOARDING_CHECKLIST.map((item) => (
              <div
                key={item.code}
                className="rounded-md border border-slate-200 bg-[#F8FAFC] p-5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-semibold tracking-[0.1em] text-slate-500">
                    {item.code}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-teal-700">
                    Mandatory
                  </span>
                </div>
                <h3 className="mt-2 text-[16px] font-semibold text-[#0F172A]">
                  {item.title}
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Direct Xero Integration Privacy Boundaries */}
      <section className="border-b border-slate-200 bg-[#F8FAFC]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="max-w-3xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-teal-700">
              Accounting Privacy Architecture
            </p>
            <h2 className="mt-1.5 text-[24px] font-semibold tracking-tight text-[#0F172A] sm:text-[28px]">
              Direct Xero integration — strict scope boundaries
            </h2>
            <p className="mt-2.5 text-[14.5px] leading-relaxed text-slate-600">
              Operators may optionally connect their own Xero organisation via
              OAuth 2.0 (tokens encrypted at rest with AES-256-GCM) so approved
              client agreements automatically raise a direct tax invoice and
              online payment link. Connecting Xero is optional—operators may
              alternatively use direct EFT banking details on their invoices.
            </p>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <div className="rounded-md border border-teal-200 bg-white p-6">
              <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-teal-800">
                <CheckCircle2 className="h-4 w-4 text-teal-700" />
                <span>Permitted Minimal Scopes (Contacts &amp; Invoices Only)</span>
              </div>
              <ul className="mt-4 space-y-3">
                {XERO_PERMITTED.map((line) => (
                  <li
                    key={line}
                    className="flex items-start gap-2.5 text-[14px] leading-relaxed text-slate-700"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-md border border-slate-300 bg-white p-6">
              <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
                <XCircle className="h-4 w-4 text-slate-500" />
                <span>Strictly Excluded Financial Data</span>
              </div>
              <ul className="mt-4 space-y-3">
                {XERO_EXCLUDED.map((line) => (
                  <li
                    key={line}
                    className="flex items-start gap-2.5 text-[14px] leading-relaxed text-slate-600"
                  >
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="mt-5 text-[13px] text-slate-500">
            Operators can revoke their Xero connection at any time from Xero or
            via coordinator administration without affecting historical PDFs or
            direct EFT fallback capability.
          </p>
        </div>
      </section>

      {/* Commercial Privacy Guarantee & Calm Admin Contact */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="rounded-md border border-slate-200 bg-[#F8FAFC] p-6 sm:p-7 lg:col-span-7">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
                <Lock className="h-3.5 w-3.5" />
                <span>Commercial Privacy Guarantee</span>
              </div>
              <h2 className="mt-2 text-[21px] font-semibold text-[#0F172A]">
                Your pricing, job numbers, and client terms remain yours
              </h2>
              <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-slate-600">
                <p>
                  The platform does not run reverse-auction bidding wars and
                  never exposes one operator&apos;s rates, line items, or
                  deposit terms to another participating company.
                </p>
                <p>
                  Every scope you submit carries your own independent job
                  reference, legal entity header, ABN, licence disclosures, and
                  payment instructions. See{" "}
                  <Link
                    href={hazmatHref(basePath, "/governance")}
                    className="font-medium text-[#0F172A] underline decoration-slate-300 underline-offset-4 hover:decoration-slate-600"
                  >
                    Governance &amp; Separation
                  </Link>{" "}
                  for full architectural controls.
                </p>
              </div>
            </div>

            <div className="rounded-md border border-slate-300 bg-[#0F172A] p-6 text-slate-200 sm:p-7 lg:col-span-5">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-teal-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Invitation-Only Onboarding</span>
              </div>
              <h2 className="mt-2 text-[20px] font-semibold text-white">
                Request an operator onboarding review
              </h2>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-slate-300">
                There is no public self-registration form. Licensed specialist
                remediation operators in Queensland and Australia wishing to be
                considered for panel onboarding may write to administration with
                their entity name, ABN, service disciplines, and operating
                region.
              </p>

              <div className="mt-5 rounded border border-slate-700 bg-slate-900/70 p-4">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-slate-400">
                  Administrative Desk
                </p>
                <a
                  href="mailto:admin@hazmatmanagement.com.au?subject=Independent%20Operator%20Onboarding%20Enquiry"
                  className="mt-1.5 inline-flex items-center gap-2 font-mono text-[13.5px] text-teal-300 hover:text-teal-200"
                >
                  <Mail className="h-4 w-4 shrink-0" />
                  <span>admin@hazmatmanagement.com.au</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
