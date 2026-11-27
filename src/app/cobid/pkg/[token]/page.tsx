"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  Scale,
  XCircle,
} from "lucide-react";
import { formatAUD } from "@/lib/cobid/utils";

interface PackageEntityCard {
  scopeId: string;
  stageOrder: number;
  companyName: string;
  abn: string;
  licenceNumber: string;
  monogram: string;
  tradeCategory: string;
  quoteType: string;
  quoteTypeCode: string;
  quoteTypeLabel: string;
  independentJobRef: string;
  agreementRef: string;
  totalIncGst: number;
  depositPercent: number;
  depositAmount: number;
  docStatus: string;
  agreementStatus: string;
  depositStatus: string;
  clientSignedAt: string | null;
  clientSignedBy: string | null;
  docUrl: string | null;
  xeroDepositOnlineUrl: string | null;
}

interface PackagePayload {
  reference: string;
  title: string;
  propertyAddress: string;
  suburbState: string;
  clientName: string;
  sentAt: string | null;
  entities: PackageEntityCard[];
}

export default function NeutralPackageIndexPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token || "";

  const [pkg, setPkg] = useState<PackagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/cobid/pkg/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Index not found");
        setPkg(data.package);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load package index"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#e2e8f0] text-xs text-slate-600">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading coordinated dispatch index…
      </div>
    );
  }

  if (error || !pkg) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#e2e8f0] p-4">
        <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-lg">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" />
          <h1 className="mt-3 text-base font-semibold text-slate-900">Index Unavailable</h1>
          <p className="mt-1.5 text-xs text-slate-600">{error || "Invalid link."}</p>
        </div>
      </div>
    );
  }

  const signedCount = pkg.entities.filter(
    (e) => e.docStatus === "signed" || e.agreementStatus === "signed"
  ).length;
  const paidCount = pkg.entities.filter((e) => e.depositStatus === "paid").length;

  return (
    <div className="min-h-screen bg-[#e2e8f0] pb-16 text-slate-900">
      <header className="border-b border-slate-200 bg-slate-950 text-white">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Coordinated Multi-Company Remediation · {pkg.reference}
          </div>
          <h1 className="mt-1 text-xl font-bold">
            {pkg.propertyAddress}
            {pkg.suburbState ? `, ${pkg.suburbState}` : ""}
          </h1>
          <p className="mt-1 text-xs text-slate-300">
            Prepared for {pkg.clientName} · {pkg.entities.length} Independent Specialist Companies
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-4 pt-6 sm:px-6 text-xs">
        {/* Strict Legal Separation Notice */}
        <section className="flex items-start gap-3 rounded-2xl border border-slate-300 bg-white p-5 shadow-xs">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-800">
            <Scale className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Separate Independent Companies — Not a Partnership or Subcontracting
            </h2>
            <p className="mt-1 leading-relaxed text-slate-600">
              Each stage below is carried out by a{" "}
              <strong className="text-slate-900">completely separate legal company</strong> with its
              own job number, scope of works, quote, legal agreement, electronic signature, and
              direct invoice. Open each company&apos;s individual link below to review and execute
              its agreement separately.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-800">
                {signedCount} of {pkg.entities.length} Separate Agreements Signed
              </span>
              <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">
                {paidCount} of {pkg.entities.length} Direct Deposits Paid
              </span>
            </div>
          </div>
        </section>

        {/* Independent Entity Cards */}
        <section className="space-y-4">
          {pkg.entities.map((e) => {
            const isSigned = e.docStatus === "signed" || e.agreementStatus === "signed";
            const isDeclined = e.docStatus === "declined";
            return (
              <div
                key={e.scopeId}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center">
                  <div className="flex items-start gap-3.5">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-xs font-bold text-white">
                      {e.monogram}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                          Stage {e.stageOrder}
                        </span>
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                          {e.quoteTypeCode}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">
                          Job {e.independentJobRef}
                        </span>
                      </div>
                      <h3 className="mt-1 text-base font-bold text-slate-900">{e.companyName}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          ABN {e.abn || "On document"}
                        </span>
                        <span>·</span>
                        <span>{e.tradeCategory}</span>
                        {e.licenceNumber && (
                          <>
                            <span>·</span>
                            <span>Lic {e.licenceNumber}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    <div className="text-right">
                      <div className="text-base font-bold text-slate-900">
                        {formatAUD(e.totalIncGst)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Deposit ({e.depositPercent}%): {formatAUD(e.depositAmount)}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {isSigned ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Signed {e.clientSignedAt ? `· ${e.clientSignedAt}` : ""}
                        </span>
                      ) : isDeclined ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-800">
                          <XCircle className="h-3.5 w-3.5" />
                          Declined
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                          Awaiting Your Signature
                        </span>
                      )}

                      {e.depositStatus === "paid" && (
                        <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white">
                          Deposit Paid
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
                  <span className="text-[11px] text-slate-500">
                    Separate contract &amp; invoice issued directly by {e.companyName}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {isSigned && e.depositStatus !== "paid" && e.xeroDepositOnlineUrl && (
                      <a
                        href={e.xeroDepositOnlineUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#13B5EA] px-3.5 py-2 font-semibold text-white hover:bg-[#0ea3d4]"
                      >
                        <CreditCard className="h-3.5 w-3.5" />
                        Pay {e.companyName} (Xero)
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {e.docUrl && (
                      <a
                        href={e.docUrl}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800"
                      >
                        {isSigned ? "View Signed Document & Receipt" : `Open ${e.companyName} Quote`}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}
