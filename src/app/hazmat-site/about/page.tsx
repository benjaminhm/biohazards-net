import type { Metadata } from "next";
import { BookOpen, Building, Globe, Mail, MapPin, Shield } from "lucide-react";

export const metadata: Metadata = {
  title: "About & Contact",
  description:
    "Entity profile, Australian operating context, technical and regulatory reference standards, and direct administrative contact for HAZMAT Management Pty Ltd.",
};

const FRAMEWORKS = [
  {
    code: "WHS",
    title: "Work Health & Safety (WHS) Legislation",
    body: "Work Health and Safety Act 2011 (Qld) and harmonised Australian WHS Regulations, including SWMS requirements for high-risk construction, biological hazards, hazardous chemicals, and asbestos controls.",
  },
  {
    code: "EPA / WASTE",
    title: "Environmental Protection & Regulated Waste Tracking",
    body: "Queensland Environmental Protection Act 1994, Waste Reduction and Recycling framework, and lawful consignment/tracking of clinical, biological, and regulated hazardous wastes by licensed transporters.",
  },
  {
    code: "REMEDIATION",
    title: "IICRC & Clandestine Lab Remediation Guidelines",
    body: "Industry standards referenced by participating specialists including IICRC S500 (Water), S520 (Mould), S540 (Trauma & Crime Scene Cleanup), and the Australian Clandestine Drug Laboratory Remediation Guidelines (enHealth / ACC).",
  },
  {
    code: "COMMERCIAL",
    title: "Electronic Execution & Tax Invoicing Compliance",
    body: "Electronic Transactions (Queensland) Act 2001 / Electronic Transactions Act 1999 (Cth) audit records and ATO-compliant GST tax invoices issued directly by each performing legal entity.",
  },
];

const PLATFORM_DOMAINS = [
  {
    host: "hazmatmanagement.com.au",
    purpose: "Public institutional governance and due-diligence reference site",
  },
  {
    host: "app.hazmatmanagement.com.au",
    purpose:
      "Authenticated workspace for coordinators and approved independent operators (onboarding & ring-fenced quoting)",
  },
  {
    host: "docs.hazmatmanagement.com.au",
    purpose:
      "Isolated client document host delivering separate per-entity quotes, agreements, PDFs, and neutral package indexes",
  },
];

export default function HazmatAboutPage() {
  return (
    <div>
      {/* Header */}
      <section className="hazmat-grid-bg border-b border-slate-200 bg-[#F8FAFC]">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-teal-700">
            Entity Reference &middot; DOC-REF HM-ENT-01
          </p>
          <h1 className="mt-2 max-w-3xl text-[30px] font-semibold leading-tight tracking-tight text-[#0F172A] sm:text-[38px]">
            About HAZMAT Management Pty Ltd
          </h1>
          <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-slate-600">
            Corporate profile, regulatory context, domain architecture, and
            direct administrative contact for governance and compliance
            enquiries.
          </p>
        </div>
      </section>

      {/* Entity Profile + Contact */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Entity Profile Card */}
            <div className="rounded-md border border-slate-200 bg-[#F8FAFC] p-6 sm:p-7 lg:col-span-7">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
                <Building className="h-3.5 w-3.5" />
                <span>Entity Profile</span>
              </div>
              <h2 className="mt-2 text-[22px] font-semibold text-[#0F172A]">
                HAZMAT Management Pty Ltd
              </h2>
              <p className="mt-2.5 text-[14px] leading-relaxed text-slate-600">
                HAZMAT Management Pty Ltd operates an independent remediation
                scoping, sequencing, and compliance-coordination platform
                serving Queensland and Australian stakeholders. The company does
                not act as a head contractor, subcontracting broker, joint
                venture, or partnership with participating specialist operators.
              </p>

              <dl className="mt-6 divide-y divide-slate-200 border-y border-slate-200 text-[13.5px]">
                <div className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-3">
                  <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500">
                    Legal Entity
                  </dt>
                  <dd className="font-medium text-[#0F172A] sm:col-span-2">
                    HAZMAT Management Pty Ltd
                  </dd>
                </div>
                <div className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-3">
                  <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500">
                    ABN
                  </dt>
                  <dd className="font-mono text-[12.5px] text-amber-800 sm:col-span-2">
                    [XX XXX XXX XXX &mdash; PLACEHOLDER]
                  </dd>
                </div>
                <div className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-3">
                  <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500">
                    ACN
                  </dt>
                  <dd className="font-mono text-[12.5px] text-amber-800 sm:col-span-2">
                    [XXX XXX XXX &mdash; PLACEHOLDER]
                  </dd>
                </div>
                <div className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-3">
                  <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500">
                    Jurisdiction
                  </dt>
                  <dd className="flex items-center gap-1.5 text-slate-700 sm:col-span-2">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" />
                    <span>Queensland, Australia (National Coordination)</span>
                  </dd>
                </div>
                <div className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-3">
                  <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500">
                    Platform Role
                  </dt>
                  <dd className="text-slate-700 sm:col-span-2">
                    Independent Scoping, Sequencing &amp; Compliance
                    Coordination
                  </dd>
                </div>
              </dl>
            </div>

            {/* Direct Administrative Contact */}
            <div className="flex flex-col justify-between rounded-md border border-slate-200 bg-white p-6 sm:p-7 lg:col-span-5">
              <div>
                <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-teal-700">
                  <Mail className="h-3.5 w-3.5" />
                  <span>Direct Administrative Contact</span>
                </div>
                <h2 className="mt-2 text-[20px] font-semibold text-[#0F172A]">
                  Governance, due diligence &amp; onboarding desk
                </h2>
                <p className="mt-2.5 text-[14px] leading-relaxed text-slate-600">
                  For insurer or loss-adjuster due-diligence requests, NDIS /
                  strata documentation queries, compliance verification, or
                  independent operator onboarding enquiries, contact
                  administration directly:
                </p>

                <div className="mt-5 rounded-md border border-slate-200 bg-[#F8FAFC] p-4">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
                    Primary Email
                  </p>
                  <a
                    href="mailto:admin@hazmatmanagement.com.au"
                    className="mt-1 inline-block font-mono text-[14.5px] font-medium text-[#0F172A] underline decoration-teal-500 underline-offset-4 hover:text-teal-800"
                  >
                    admin@hazmatmanagement.com.au
                  </a>
                </div>
              </div>

              <div className="mt-6 rounded-md border border-amber-200 bg-amber-50/70 p-4 text-[12.5px] leading-relaxed text-amber-950">
                <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-amber-800">
                  Existing Job / Document Queries
                </p>
                <p className="mt-1">
                  If your enquiry relates to a specific quote, scope, or tax
                  invoice received via{" "}
                  <span className="font-mono">docs.hazmatmanagement.com.au</span>
                  , please contact the performing operating company named on
                  that document directly, or include the project reference when
                  writing to administration.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Technical & Regulatory Reference Frameworks */}
      <section className="border-b border-slate-200 bg-[#F8FAFC]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
              <BookOpen className="h-3.5 w-3.5" />
              <span>Technical &amp; Regulatory Context</span>
            </div>
            <h2 className="mt-1.5 text-[24px] font-semibold tracking-tight text-[#0F172A] sm:text-[28px]">
              Frameworks referenced across coordinated works
            </h2>
            <p className="mt-2 text-[14.5px] text-slate-600">
              Each independent operating company remains solely responsible for
              statutory compliance within its licensed discipline. Platform
              scoping and documentation workflows are structured around the
              following Australian standards and legislation:
            </p>
          </div>

          <div className="mt-9 grid gap-4 md:grid-cols-2">
            {FRAMEWORKS.map((fw) => (
              <div
                key={fw.code}
                className="rounded-md border border-slate-200 bg-white p-5"
              >
                <span className="inline-block rounded-sm border border-slate-300 bg-[#F8FAFC] px-2 py-0.5 font-mono text-[10.5px] font-semibold tracking-[0.1em] text-slate-600">
                  {fw.code}
                </span>
                <h3 className="mt-2.5 text-[16px] font-semibold text-[#0F172A]">
                  {fw.title}
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">
                  {fw.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Verified Domain Architecture */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
            <Globe className="h-3.5 w-3.5" />
            <span>Verified Domain Architecture</span>
          </div>
          <h2 className="mt-1.5 text-[20px] font-semibold text-[#0F172A]">
            Official platform hostnames
          </h2>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {PLATFORM_DOMAINS.map((d) => (
              <div
                key={d.host}
                className="rounded-md border border-slate-200 bg-[#F8FAFC] p-4"
              >
                <div className="flex items-center gap-2 font-mono text-[12.5px] font-semibold text-[#0F172A]">
                  <Shield className="h-3.5 w-3.5 shrink-0 text-teal-700" />
                  <span>{d.host}</span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
                  {d.purpose}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
