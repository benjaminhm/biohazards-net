import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  FileCheck2,
  Landmark,
  Layers,
  Lock,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import { hazmatHref } from "@/components/hazmat-site/paths";
import { getHazmatBasePath } from "@/components/hazmat-site/serverPath";

export const metadata: Metadata = {
  title: "Overview",
  description:
    "HAZMAT Management Pty Ltd is an independent remediation scoping, sequencing, and compliance-coordination platform connecting property stakeholders with verified independent specialist operators.",
};

const ARCHITECTURE_STAGES = [
  {
    code: "STAGE 01",
    title: "Site Intake & Sequencing",
    summary:
      "Multi-discipline remediation works are mapped into ordered technical scopes (decontamination, clearance testing, contents removal, specialist make-safe) with clear handover dependencies.",
    tag: "Coordination Layer",
  },
  {
    code: "STAGE 02",
    title: "Verified Specialist Operators",
    summary:
      "Only independently incorporated operating companies with verified ABNs, current Public Liability & WorkCover policies, active licences, and signed platform deeds may issue quotes.",
    tag: "Compliance-Gated",
  },
  {
    code: "STAGE 03",
    title: "Separate Contracts & Direct Settlement",
    summary:
      "Each operating company issues its own quote, service agreement, and tax invoice on docs.hazmatmanagement.com.au. Clients sign and settle directly with each performing entity.",
    tag: "Zero Commingling",
  },
  {
    code: "STAGE 04",
    title: "Handover Gates & Clearance Audit",
    summary:
      "Field progression follows verified stage gates. Signed agreements, cryptographic SHA-256 document hashes, clearance certificates, and invoices are archived in an auditable record.",
    tag: "Audit-Ready",
  },
];

const GOVERNANCE_PILLARS = [
  {
    ref: "PILLAR 01",
    icon: ShieldCheck,
    title: "Independent Legal Entities Only",
    body: "HAZMAT Management Pty Ltd is not a head contractor, partnership, joint venture, or subcontracting broker. Every operator contracts directly with the client under its own ABN, licences, and insurance.",
  },
  {
    ref: "PILLAR 02",
    icon: Lock,
    title: "Commercial Ring-Fencing",
    body: "Participating companies only see their assigned technical scope and handover status. Pricing, margins, client terms, and invoices of other operators are strictly isolated at the database and API layers.",
  },
  {
    ref: "PILLAR 03",
    icon: Landmark,
    title: "Direct-to-Operator Settlement",
    body: "Funds never pass through a pooled or broker trust account. Tax invoices are issued directly from each performing entity (via scoped Xero integration or direct EFT) payable straight to that operator.",
  },
  {
    ref: "PILLAR 04",
    icon: FileCheck2,
    title: "Compliance Vault & Audit Docket",
    body: "Insurance certificates, workers compensation, licences, and SWMS are verified before job allocation with expiry gating. Every executed client document carries a frozen PDF and SHA-256 verification record.",
  },
];

const STAKEHOLDERS = [
  {
    icon: ShieldCheck,
    role: "Insurers & Loss Adjusters",
    detail:
      "Transparent, unbundled scope quoting across biological, methamphetamine, forensic, and restoration trades—without opaque head-contractor markups, cross-subsidised billing, or unclear liability chains.",
  },
  {
    icon: Users,
    role: "NDIS & Support Coordinators",
    detail:
      "Clear line-item documentation and separate tax invoices issued directly by the performing specialist entity, supporting plan-managed and NDIA-compliant audit and reimbursement workflows.",
  },
  {
    icon: Building2,
    role: "Strata & Property Managers",
    detail:
      "Sequenced coordination for complex incidents affecting common property and lots, with verifiable WHS documentation, currency of insurance checks, and clean committee-ready paperwork.",
  },
  {
    icon: Wrench,
    role: "Licensed Specialist Operators",
    detail:
      "Participate in complex multi-stage remediation projects while retaining complete legal autonomy, direct client contracting, protected commercial pricing, and direct Xero invoicing.",
  },
];

export default async function HazmatOverviewPage() {
  const basePath = await getHazmatBasePath();

  return (
    <div>
      {/* Hero / Institutional Positioning */}
      <section className="hazmat-grid-bg border-b border-slate-200 bg-[#F8FAFC]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-22">
          <div className="max-w-3xl space-y-6">
            <div className="inline-flex items-center gap-2 rounded-sm border border-slate-300 bg-white px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-slate-700">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-600" />
              <span>Institutional Governance &amp; Coordination Reference</span>
            </div>

            <h1 className="text-[32px] font-semibold leading-[1.15] tracking-tight text-[#0F172A] sm:text-[42px]">
              Independent remediation scoping, sequencing, and compliance
              coordination.
            </h1>

            <p className="text-[16.5px] leading-relaxed text-slate-600 sm:text-[17.5px]">
              HAZMAT Management Pty Ltd provides the structured coordination
              infrastructure used to sequence multi-discipline biohazard,
              forensic, methamphetamine, and specialist remediation works across
              independent, compliance-verified operating companies.
            </p>

            {/* Legal Truth Notice Strip */}
            <div className="rounded-md border border-slate-300 bg-white p-4 sm:p-5">
              <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Structural &amp; Legal Disclosure
              </p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-slate-700">
                <strong className="font-semibold text-[#0F172A]">
                  HAZMAT Management Pty Ltd is not a head contractor, not a
                  partnership, not a joint venture, and not a subcontracting
                  broker.
                </strong>{" "}
                Every operating company engaged through the platform is an
                independent legal entity responsible for its own job, scope,
                quotation, client agreement, ABN, insurances, workmanship, and
                direct invoicing.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href={hazmatHref(basePath, "/how-it-works")}
                className="inline-flex items-center gap-2 rounded-md bg-[#0F172A] px-4 py-2.5 text-[13.5px] font-medium text-white transition-colors hover:bg-slate-800"
              >
                <span>How Coordination Works</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href={hazmatHref(basePath, "/governance")}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-[13.5px] font-medium text-[#0F172A] transition-colors hover:border-slate-400 hover:bg-slate-50"
              >
                <span>Review Governance &amp; Separation</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 4-Stage Visual Architecture Diagram */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div className="max-w-2xl">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-teal-700">
                System Architecture
              </p>
              <h2 className="mt-1.5 text-[24px] font-semibold tracking-tight text-[#0F172A] sm:text-[28px]">
                Four-stage coordinated remediation architecture
              </h2>
            </div>
            <p className="font-mono text-[11.5px] text-slate-500">
              APP.HAZMATMANAGEMENT.COM.AU &rarr; DOCS.HAZMATMANAGEMENT.COM.AU
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {ARCHITECTURE_STAGES.map((stage, idx) => (
              <div
                key={stage.code}
                className="relative flex flex-col justify-between rounded-md border border-slate-200 bg-[#F8FAFC] p-5"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-semibold tracking-[0.1em] text-slate-500">
                      {stage.code}
                    </span>
                    <span className="rounded-sm border border-teal-200 bg-teal-50 px-2 py-0.5 font-mono text-[10px] font-medium text-teal-800">
                      {stage.tag}
                    </span>
                  </div>
                  <h3 className="mt-3 text-[16px] font-semibold leading-snug text-[#0F172A]">
                    {stage.title}
                  </h3>
                  <p className="mt-2.5 text-[13.5px] leading-relaxed text-slate-600">
                    {stage.summary}
                  </p>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-3 font-mono text-[10.5px] text-slate-400">
                  <span>STEP {idx + 1} OF 4</span>
                  {idx < ARCHITECTURE_STAGES.length - 1 ? (
                    <span className="text-slate-500">HANDOFF &rarr;</span>
                  ) : (
                    <span className="text-teal-700">RECORD ARCHIVED</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4 Governance Pillars */}
      <section className="border-b border-slate-200 bg-[#F8FAFC]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="max-w-2xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
              Structural Controls
            </p>
            <h2 className="mt-1.5 text-[24px] font-semibold tracking-tight text-[#0F172A] sm:text-[28px]">
              Four governance pillars enforced by platform architecture
            </h2>
            <p className="mt-2.5 text-[15px] text-slate-600">
              Separation between coordinating infrastructure and performing
              operators is enforced both contractually and technically across
              hosting, authentication, document generation, and payment rails.
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {GOVERNANCE_PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <div
                  key={pillar.ref}
                  className="rounded-md border border-slate-200 bg-white p-6"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-medium tracking-[0.12em] text-slate-400">
                      {pillar.ref}
                    </span>
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-[#F8FAFC] text-slate-700">
                      <Icon className="h-4 w-4" />
                    </span>
                  </div>
                  <h3 className="mt-3 text-[17px] font-semibold text-[#0F172A]">
                    {pillar.title}
                  </h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-slate-600">
                    {pillar.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Who Uses This Framework */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="max-w-2xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
              Stakeholder Alignment
            </p>
            <h2 className="mt-1.5 text-[24px] font-semibold tracking-tight text-[#0F172A] sm:text-[28px]">
              Who uses this framework
            </h2>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {STAKEHOLDERS.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.role}
                  className="flex gap-4 rounded-md border border-slate-200 bg-[#F8FAFC] p-5"
                >
                  <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-slate-700">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-[15.5px] font-semibold text-[#0F172A]">
                      {item.role}
                    </h3>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-600">
                      {item.detail}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Document Recipient Guidance Band */}
      <section className="bg-[#F8FAFC]">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
          <div className="flex flex-col justify-between gap-6 rounded-md border border-slate-300 bg-white p-6 sm:p-8 lg:flex-row lg:items-center">
            <div className="max-w-2xl space-y-2">
              <div className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-amber-700">
                <Layers className="h-3.5 w-3.5" />
                <span>Received Links from docs.hazmatmanagement.com.au?</span>
              </div>
              <h2 className="text-[20px] font-semibold text-[#0F172A]">
                Why a coordinated project arrives as separate entity quotes and
                invoices
              </h2>
              <p className="text-[14px] leading-relaxed text-slate-600">
                When a property requires more than one specialist discipline,
                each independent operating company issues its own quote,
                agreement, and tax invoice under its own ABN. Review our
                plain-English explanation and legal separation rules before
                signing.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <Link
                href={hazmatHref(basePath, "/how-it-works")}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-[#F8FAFC] px-4 py-2.5 text-[13.5px] font-medium text-[#0F172A] transition-colors hover:border-slate-400 hover:bg-slate-100"
              >
                <span>Read Plain-English Guide</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href={hazmatHref(basePath, "/operators")}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-[13.5px] font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-[#0F172A]"
              >
                <span>Operator Requirements</span>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
