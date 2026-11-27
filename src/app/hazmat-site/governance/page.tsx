import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  FileKey2,
  Landmark,
  Lock,
  Scale,
  ShieldAlert,
} from "lucide-react";
import { hazmatHref } from "@/components/hazmat-site/paths";
import { getHazmatBasePath } from "@/components/hazmat-site/serverPath";

export const metadata: Metadata = {
  title: "Governance & Separation",
  description:
    "Legal and technical governance controls of HAZMAT Management Pty Ltd: independent entities only, commercial ring-fencing, direct-to-operator settlement, compliance expiry gating, and SHA-256 signing audit dockets.",
};

const CONTROLS = [
  {
    id: "GOV-01",
    icon: Scale,
    title: "Independent Entities Only — No Partnership or Subcontracting",
    status: "Contractual & Structural",
    points: [
      "HAZMAT Management Pty Ltd acts solely as an independent scoping, sequencing, and compliance-coordination platform.",
      "No partnership, joint venture, agency, employment, or head-contractor / subcontractor relationship exists between HAZMAT Management Pty Ltd and any operating company, nor between participating operating companies.",
      "Each operating company contracts directly with the client (or appointing stakeholder) in its own legal name, under its own ABN/ACN, terms of trade, warranties, and statutory licences.",
    ],
  },
  {
    id: "GOV-02",
    icon: Lock,
    title: "Commercial Ring-Fencing & Role-Scoped Access",
    status: "Database & API Enforced",
    points: [
      "Participating operating companies access only their own assigned scopes, bid forms, invoices, and compliance documents.",
      "Cross-entity commercial figures—including other operators' quotes, unit rates, deposits, margins, and client commercial agreements—are structurally hidden to prevent price-signalling or commercial interference.",
      "The public document delivery host (docs.hazmatmanagement.com.au) is strictly isolated from internal workspaces and serves only token-scoped individual entity documents and neutral package indexes.",
    ],
  },
  {
    id: "GOV-03",
    icon: Landmark,
    title: "Direct-to-Operator Settlement — Zero Commingling",
    status: "Financial Separation",
    points: [
      "HAZMAT Management Pty Ltd does not collect, hold, pool, or disburse client remediation payments on behalf of operating companies.",
      "Deposit and final tax invoices are raised directly by each performing operating company—either through its own connected Xero organisation (generating a direct Xero Online Invoice payment link) or via that entity's direct EFT banking details.",
      "GST, PAYG, superannuation, and income tax obligations remain strictly with each performing legal entity.",
    ],
  },
  {
    id: "GOV-04",
    icon: ShieldAlert,
    title: "Mandatory Compliance Vault & Expiry Controls",
    status: "Hard Allocation Gate",
    points: [
      "Before an operating company can be approved for job allocation, it must complete a multi-step verification workflow uploading current Public Liability insurance, Workers Compensation / WorkCover currency, required trade or hazmat licences, and Safe Work Method Statements (SWMS), plus execute the Independent Operator Platform Deed.",
      "Policy expiry dates are tracked per entity. Operators with unapproved status, suspended status, or expired mandatory insurance are hard-blocked from new scope allocation until renewed evidence is verified.",
    ],
  },
  {
    id: "GOV-05",
    icon: FileKey2,
    title: "Electronic Signing & SHA-256 Audit Docket",
    status: "Cryptographic Verification",
    points: [
      "Each operating company's quote and client agreement is rendered as a frozen per-entity document on docs.hazmatmanagement.com.au carrying that operator's legal name, ABN, independent job reference, and scope.",
      "Electronic execution records signer name, role/capacity, timestamp, IP address, user-agent, and signature capture in accordance with Australian electronic transactions legislation.",
      "A cryptographic SHA-256 digest of the executed document record is stored in the audit trail so insurers, adjusters, and legal reviewers can verify document integrity after execution.",
    ],
  },
];

const COMPARISON_ROWS = [
  {
    dimension: "Contracting Party",
    traditional: "Single head contractor subcontracts works behind the scenes",
    hazmat:
      "Each specialist legal entity contracts directly with the client for its own scope",
  },
  {
    dimension: "Invoicing & Cash Flow",
    traditional: "Pooled billing with opaque margins and subcontractor pass-throughs",
    hazmat:
      "Separate tax invoice from each performing entity; paid directly to that operator",
  },
  {
    dimension: "Licence & Insurance Liability",
    traditional: "Layered indemnities across head contractor and undisclosed subcontractors",
    hazmat:
      "Direct legal privity with the licensed, compliance-verified performing entity",
  },
  {
    dimension: "Commercial Privacy",
    traditional: "Shared tender sheets or informal quote shopping across trades",
    hazmat:
      "Role-scoped commercial ring-fencing; operators cannot view peer pricing",
  },
  {
    dimension: "Site Sequencing",
    traditional: "Informal phone/email handoffs between trades",
    hazmat:
      "Structured stage gates and archived completion & clearance audit trail",
  },
];

export default async function HazmatGovernancePage() {
  const basePath = await getHazmatBasePath();

  return (
    <div>
      {/* Header */}
      <section className="hazmat-grid-bg border-b border-slate-200 bg-[#F8FAFC]">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-teal-700">
            Governance Framework &middot; DOC-REF HM-GOV-01
          </p>
          <h1 className="mt-2 max-w-3xl text-[30px] font-semibold leading-tight tracking-tight text-[#0F172A] sm:text-[38px]">
            Governance, legal separation, and technical controls
          </h1>
          <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-slate-600">
            Designed for institutional due diligence by insurers, loss
            adjusters, NDIS plan managers, strata committees, and legal counsel.
          </p>
        </div>
      </section>

      {/* Numbered Controls */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="space-y-6">
            {CONTROLS.map((ctrl) => {
              const Icon = ctrl.icon;
              return (
                <article
                  key={ctrl.id}
                  className="rounded-md border border-slate-200 bg-[#F8FAFC] p-6 sm:p-7"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded border border-slate-300 bg-white text-[#0F172A]">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div>
                        <span className="font-mono text-[11px] font-semibold tracking-[0.12em] text-slate-500">
                          {ctrl.id}
                        </span>
                        <h2 className="text-[18px] font-semibold leading-snug text-[#0F172A]">
                          {ctrl.title}
                        </h2>
                      </div>
                    </div>
                    <span className="rounded-sm border border-teal-200 bg-teal-50 px-2.5 py-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-teal-800">
                      {ctrl.status}
                    </span>
                  </div>

                  <ul className="mt-4 space-y-2.5">
                    {ctrl.points.map((pt) => (
                      <li
                        key={pt}
                        className="flex items-start gap-3 text-[14px] leading-relaxed text-slate-700"
                      >
                        <span
                          className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400"
                          aria-hidden="true"
                        />
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* Structural Comparison Matrix */}
      <section className="border-b border-slate-200 bg-[#F8FAFC]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="max-w-2xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
              Structural Distinction
            </p>
            <h2 className="mt-1.5 text-[24px] font-semibold tracking-tight text-[#0F172A] sm:text-[28px]">
              Coordination platform vs. traditional head-contractor model
            </h2>
          </div>

          <div className="mt-8 overflow-x-auto rounded-md border border-slate-200 bg-white">
            <table className="w-full border-collapse text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                    Dimension
                  </th>
                  <th className="px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                    Traditional Head Contractor
                  </th>
                  <th className="px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-teal-800">
                    HAZMAT Management Model
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.dimension}>
                    <td className="whitespace-nowrap px-4 py-3.5 align-top font-semibold text-[#0F172A]">
                      {row.dimension}
                    </td>
                    <td className="px-4 py-3.5 align-top text-slate-500">
                      {row.traditional}
                    </td>
                    <td className="px-4 py-3.5 align-top font-medium text-slate-800">
                      {row.hazmat}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-md border border-slate-200 bg-white p-5">
            <p className="text-[14px] text-slate-700">
              Are you a specialist remediation business evaluating onboarding
              standards and Xero privacy boundaries?
            </p>
            <Link
              href={hazmatHref(basePath, "/operators")}
              className="inline-flex items-center gap-2 rounded-md bg-[#0F172A] px-4 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-slate-800"
            >
              <span>For Independent Operators</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
