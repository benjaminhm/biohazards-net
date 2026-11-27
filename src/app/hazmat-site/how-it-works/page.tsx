import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, HelpCircle } from "lucide-react";
import { hazmatHref } from "@/components/hazmat-site/paths";
import { getHazmatBasePath } from "@/components/hazmat-site/serverPath";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "End-to-end 6-step lifecycle for multi-discipline remediation scoping, structured quoting (BCQ, SACQ, CCQ, MTQ), separate entity document dispatch, direct settlement, and clearance handover.",
};

const QUOTE_TYPES = [
  {
    code: "BCQ",
    name: "Biohazard Cleaning Quote",
    scope:
      "Forensic, trauma, unattended death, bodily fluid, and biological hazard decontamination and regulated clinical waste disposal.",
  },
  {
    code: "SACQ",
    name: "Surface & Structural Area Cleaning Quote",
    scope:
      "Gross filth, hoarding, sewage, mould, soot, or environmental contamination remediation requiring structured area-by-area scopes.",
  },
  {
    code: "CCQ",
    name: "Contents Clearance Quote",
    scope:
      "Contaminated or unsalvageable contents sorting, inventorying, secure removal, and lawful disposal prior to or alongside decontamination.",
  },
  {
    code: "MTQ",
    name: "Methamphetamine Testing Quote",
    scope:
      "Presumptive screening, laboratory-accredited composite or discrete NATA swab sampling, and post-remediation clearance verification.",
  },
  {
    code: "TRADE",
    name: "Specialist Trade & Make-Safe Quotes",
    scope:
      "Licensed carpentry, plumbing, electrical isolation, HVAC remediation, asbestos removal, or restoration trades sequenced after clearance.",
  },
];

const LIFECYCLE_STEPS = [
  {
    step: "01",
    title: "Site Assessment & Scope Sequencing",
    summary:
      "A complex site is assessed and divided into discrete technical stages (for example: initial testing → contents clearance → biological/chemical decontamination → post-remediation clearance → trade reinstatement). Each stage is assigned to an approved, independently incorporated specialist company.",
    artifact: "Sequenced project schedule & stage dependencies",
  },
  {
    step: "02",
    title: "Structured Specialist Quoting",
    summary:
      "Each assigned operating company receives a ring-fenced bid link on app.hazmatmanagement.com.au to build its own technical scope, inclusions, exclusions, commercial pricing, deposit terms, and independent job reference using structured templates (BCQ, SACQ, CCQ, MTQ, or Custom Trade).",
    artifact: "Independent scope & pricing per legal entity",
  },
  {
    step: "03",
    title: "Separate Document Dispatch on docs.hazmatmanagement.com.au",
    summary:
      "Once ready, each company's quote and service agreement is frozen as its own standalone document with its own entity header, ABN, licence numbers, and terms. Clients may receive a neutral package index (/pkg/...) linking out to each separate entity document.",
    artifact: "Individual entity URLs & standalone PDFs",
  },
  {
    step: "04",
    title: "Independent Electronic Signing & Direct Payment",
    summary:
      "The client reviews and signs each entity's agreement separately. Upon execution, the performing entity issues its own tax invoice (via its connected Xero organisation or direct EFT details). Deposit and balance payments settle straight to that performing company's bank account.",
    artifact: "Signed agreement + SHA-256 hash + direct tax invoice",
  },
  {
    step: "05",
    title: "Sequenced Field Execution & Handover Gates",
    summary:
      "Operators mobilise in the agreed technical order. Downstream trades do not commence until upstream hazard clearance or prerequisite gates are marked complete—preventing cross-contamination, wasted site attendance, and WHS breaches.",
    artifact: "Timestamped stage-gate progression log",
  },
  {
    step: "06",
    title: "Completion Pack & Audit Trail",
    summary:
      "Upon completion, each operator uploads its own completion evidence, waste dockets, clearance certificates, and final invoice reference. Stakeholders receive an organised record where every document clearly identifies the legal entity responsible for that work.",
    artifact: "Auditable multi-entity completion record",
  },
];

export default async function HazmatHowItWorksPage() {
  const basePath = await getHazmatBasePath();

  return (
    <div>
      {/* Page Header */}
      <section className="hazmat-grid-bg border-b border-slate-200 bg-[#F8FAFC]">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-teal-700">
            Operational Lifecycle &middot; DOC-REF HM-OPS-01
          </p>
          <h1 className="mt-2 max-w-3xl text-[30px] font-semibold leading-tight tracking-tight text-[#0F172A] sm:text-[38px]">
            How coordinated multi-entity remediation works
          </h1>
          <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-slate-600">
            From initial site sequencing to independent quoting, separate client
            agreements, direct settlement, and verified handover gates.
          </p>
        </div>
      </section>

      {/* Prominent Plain-English Client Explainer */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
          <div className="rounded-md border-2 border-slate-900 bg-[#F8FAFC] p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-amber-300 bg-amber-50 text-amber-800">
                <HelpCircle className="h-4 w-4" />
              </span>
              <div className="space-y-3">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-800">
                  Plain-English Client &amp; Stakeholder Explainer
                </p>
                <h2 className="text-[21px] font-semibold tracking-tight text-[#0F172A] sm:text-[24px]">
                  Why did I receive separate quotes, agreements, and invoices?
                </h2>
                <p className="text-[14.5px] leading-relaxed text-slate-700">
                  Remediation sites often require distinct licensed
                  specialists—for example, independent methamphetamine testing,
                  biohazard decontamination, contents disposal, and licensed
                  building make-safe. Under a traditional head-contractor model,
                  one company marks up and subcontracts the rest, obscuring who
                  holds the licence, who carries the insurance liability, and
                  where your money goes.
                </p>
                <p className="text-[14.5px] leading-relaxed text-slate-700">
                  Through the HAZMAT Management platform,{" "}
                  <strong className="font-semibold text-[#0F172A]">
                    each specialist company quotes, contracts, and invoices you
                    directly
                  </strong>{" "}
                  while sharing a coordinated sequence so work happens in the
                  right order.
                </p>

                <div className="grid gap-3 pt-2 sm:grid-cols-3">
                  <div className="rounded border border-slate-200 bg-white p-3.5">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-[#0F172A]">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-700" />
                      <span>Direct Legal Accountability</span>
                    </div>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600">
                      Your agreement is directly with the licensed, insured
                      company performing that specific stage of work.
                    </p>
                  </div>
                  <div className="rounded border border-slate-200 bg-white p-3.5">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-[#0F172A]">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-700" />
                      <span>Direct Payment, Zero Commingling</span>
                    </div>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600">
                      Each tax invoice is paid directly to that operator&apos;s
                      ABN and bank account—never into a pooled broker account.
                    </p>
                  </div>
                  <div className="rounded border border-slate-200 bg-white p-3.5">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-[#0F172A]">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-700" />
                      <span>Independent Decision Per Scope</span>
                    </div>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600">
                      You review every company&apos;s ABN, scope, price, and
                      terms transparently before choosing to sign each document.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6-Step Lifecycle */}
      <section className="border-b border-slate-200 bg-[#F8FAFC]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="max-w-2xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
              Process Sequence
            </p>
            <h2 className="mt-1.5 text-[24px] font-semibold tracking-tight text-[#0F172A] sm:text-[28px]">
              Six-step project lifecycle
            </h2>
          </div>

          <ol className="mt-10 space-y-4">
            {LIFECYCLE_STEPS.map((item) => (
              <li
                key={item.step}
                className="rounded-md border border-slate-200 bg-white p-6"
              >
                <div className="grid gap-4 md:grid-cols-12 md:items-start">
                  <div className="md:col-span-2">
                    <span className="inline-flex items-center rounded-sm border border-slate-300 bg-[#F8FAFC] px-2.5 py-1 font-mono text-[12px] font-semibold text-[#0F172A]">
                      STEP {item.step}
                    </span>
                  </div>
                  <div className="space-y-2 md:col-span-7">
                    <h3 className="text-[17px] font-semibold text-[#0F172A]">
                      {item.title}
                    </h3>
                    <p className="text-[14px] leading-relaxed text-slate-600">
                      {item.summary}
                    </p>
                  </div>
                  <div className="border-t border-slate-100 pt-3 md:col-span-3 md:border-l md:border-t-0 md:pl-5 md:pt-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">
                      Recorded Output
                    </p>
                    <p className="mt-1 text-[13px] font-medium text-slate-700">
                      {item.artifact}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Structured Quote Classification Table */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="max-w-2xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
              Standardised Quote Formats
            </p>
            <h2 className="mt-1.5 text-[24px] font-semibold tracking-tight text-[#0F172A] sm:text-[28px]">
              Structured specialist quoting categories
            </h2>
            <p className="mt-2 text-[14.5px] text-slate-600">
              Operators prepare structured scopes aligned to industry
              remediation disciplines so insurers, NDIS coordinators, and
              property stakeholders can evaluate line items consistently.
            </p>
          </div>

          <div className="mt-8 overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full border-collapse text-left text-[14px]">
              <thead>
                <tr className="border-b border-slate-200 bg-[#F8FAFC]">
                  <th className="px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                    Code
                  </th>
                  <th className="px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                    Quote Format
                  </th>
                  <th className="px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                    Typical Scope Covered by Independent Specialist
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {QUOTE_TYPES.map((q) => (
                  <tr key={q.code}>
                    <td className="whitespace-nowrap px-4 py-3.5 align-top">
                      <span className="inline-block rounded-sm border border-slate-300 bg-slate-50 px-2 py-0.5 font-mono text-[12px] font-semibold text-[#0F172A]">
                        {q.code}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 align-top font-medium text-[#0F172A]">
                      {q.name}
                    </td>
                    <td className="px-4 py-3.5 align-top text-slate-600">
                      {q.scope}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-md border border-slate-200 bg-[#F8FAFC] p-5">
            <p className="text-[14px] text-slate-700">
              Need the formal legal and technical separation controls behind
              this workflow?
            </p>
            <Link
              href={hazmatHref(basePath, "/governance")}
              className="inline-flex items-center gap-2 rounded-md bg-[#0F172A] px-4 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-slate-800"
            >
              <span>Inspect Governance Controls</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
