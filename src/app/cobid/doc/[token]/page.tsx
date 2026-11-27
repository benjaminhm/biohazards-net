"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Download,
  ExternalLink,
  FileSignature,
  Landmark,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { formatAUD } from "@/lib/cobid/utils";

interface PublicEntityDoc {
  companyName: string;
  legalEntityName: string;
  tradingName: string;
  abn: string;
  acn: string;
  licenceNumber: string;
  monogram: string;
  contactName: string;
  contactEmail: string;
  phone: string;
  logoUrl: string | null;
  tradeCategory: string;
  quoteType: string;
  quoteTypeCode: string;
  quoteTypeLabel: string;
  stageOrder: number;
  independentJobRef: string;
  agreementRef: string;
  docStatus: string;
  agreementStatus: string;
  snapshotHtml: string;
  propertyAddress: string;
  suburbState: string;
  clientName: string;
  clientEmail: string;
  settlementRail: string;
  subtotalExGst: number;
  gst: number;
  gstRegistered: boolean;
  totalIncGst: number;
  depositPercent: number;
  depositAmount: number;
  clientSignedAt: string | null;
  clientSignedBy: string | null;
  agreementAuditHash: string | null;
  docDeclineReason: string | null;
  bankName: string;
  bsb: string;
  accountNumber: string;
  payId: string;
  depositStatus: string;
  depositPaidAt: string | null;
  xeroDepositInvoiceNumber: string | null;
  xeroDepositOnlineUrl: string | null;
  xeroLastError: string | null;
  pdfUrl: string;
  packageUrl: string | null;
}

export default function StandaloneEntityDocPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token || "";

  const [doc, setDoc] = useState<PublicEntityDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Signing form
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [signerCapacity, setSignerCapacity] = useState("");
  const [legalAck, setLegalAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Decline toggle
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const loadDoc = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/cobid/doc/${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Document not found");
      setDoc(data.document);
      setSignerName((prev) => prev || data.document.clientName || "");
      setSignerEmail((prev) => prev || data.document.clientEmail || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load document");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadDoc();
  }, [loadDoc]);

  const handleSign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!legalAck || !signerName.trim() || submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/cobid/doc/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sign",
          signerName: signerName.trim(),
          signerEmail: signerEmail.trim(),
          signerCapacity: signerCapacity.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data?.error || "Could not sign document");
        return;
      }
      if (data.document) setDoc(data.document);
    } catch {
      setActionError("Network error while signing. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/cobid/doc/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "decline",
          reason: declineReason.trim() || "Declined by client",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data?.error || "Could not record response");
        return;
      }
      if (data.document) setDoc(data.document);
      setShowDecline(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#d6e2f0] text-xs text-slate-700">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading independent quote &amp; agreement…
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#d6e2f0] p-4">
        <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-lg">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" />
          <h1 className="mt-3 text-base font-semibold text-slate-900">Document Unavailable</h1>
          <p className="mt-1.5 text-xs text-slate-600">{error || "Invalid document link."}</p>
        </div>
      </div>
    );
  }

  const isSigned = doc.docStatus === "signed" || doc.agreementStatus === "signed";
  const isDeclined = doc.docStatus === "declined";

  return (
    <div className="min-h-screen bg-[#e2e8f0] pb-16 text-slate-900">
      {/* Top Action Bar */}
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            {doc.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={doc.logoUrl}
                alt={doc.tradingName}
                className="h-8 max-w-[100px] rounded border border-slate-200 bg-white object-contain p-0.5"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">
                {doc.monogram}
              </div>
            )}
            <div>
              <div className="text-xs font-bold text-slate-900">{doc.tradingName}</div>
              <div className="text-[11px] text-slate-500">
                ABN {doc.abn || "TBA"} · Job {doc.independentJobRef}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {doc.packageUrl && (
              <a
                href={doc.packageUrl}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                All Quotes Index
              </a>
            )}
            <a
              href={doc.pdfUrl}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              Download PDF
            </a>
            {isSigned ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Signed
              </span>
            ) : isDeclined ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1 font-semibold text-rose-800">
                <XCircle className="h-3.5 w-3.5" />
                Declined
              </span>
            ) : (
              <a
                href="#sign-panel"
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3.5 py-1.5 font-semibold text-white hover:bg-slate-800"
              >
                <FileSignature className="h-3.5 w-3.5" />
                Review &amp; Sign
              </a>
            )}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-4xl space-y-6 px-4 pt-6 sm:px-6">
        {/* Post-Sign Success & Direct Payment Card (Pinned Top Once Signed) */}
        {isSigned && (
          <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-md">
            <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  <div>
                    <h2 className="text-sm font-bold text-emerald-950">
                      Agreement Executed Directly with {doc.legalEntityName}
                    </h2>
                    <p className="mt-0.5 text-xs text-emerald-800">
                      Signed by <strong>{doc.clientSignedBy}</strong> on {doc.clientSignedAt} ·{" "}
                      <span className="font-mono">{doc.agreementAuditHash}</span>
                    </p>
                  </div>
                </div>
                <a
                  href={doc.pdfUrl}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  Signed PDF
                </a>
              </div>
            </div>

            <div className="p-5 text-xs">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <Landmark className="h-3.5 w-3.5" />
                    Pay Direct to {doc.tradingName} (ABN {doc.abn})
                  </div>
                  <div className="mt-1 text-lg font-bold text-slate-900">
                    Deposit Due ({doc.depositPercent}%): {formatAUD(doc.depositAmount)}
                  </div>
                  <p className="mt-0.5 text-slate-600">
                    {doc.depositStatus === "paid"
                      ? `Deposit received (${doc.depositPaidAt || "Confirmed"}). Thank you!`
                      : `Funds are paid directly to ${doc.legalEntityName} under Job ${doc.independentJobRef}.`}
                  </p>
                </div>

                {doc.depositStatus === "paid" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100 px-4 py-2.5 text-sm font-bold text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" />
                    Deposit Paid
                  </span>
                ) : doc.xeroDepositOnlineUrl ? (
                  <a
                    href={doc.xeroDepositOnlineUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#13B5EA] px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#0ea3d4]"
                  >
                    <CreditCard className="h-4 w-4" />
                    Pay {doc.tradingName} Now (Xero Invoice{" "}
                    {doc.xeroDepositInvoiceNumber || ""})
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : null}
              </div>

              {doc.depositStatus !== "paid" && (doc.bsb || doc.accountNumber || doc.payId) && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <div className="font-semibold text-slate-800">
                    Direct Bank Transfer / PayID — {doc.legalEntityName}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 font-mono text-slate-700">
                    {doc.bankName && <span>Bank: {doc.bankName}</span>}
                    {doc.bsb && <span>BSB: {doc.bsb}</span>}
                    {doc.accountNumber && <span>Account: {doc.accountNumber}</span>}
                    {doc.payId && <span>PayID: {doc.payId}</span>}
                    <span>
                      Reference: <strong>{doc.xeroDepositInvoiceNumber || doc.independentJobRef}</strong>
                    </span>
                  </div>
                </div>
              )}

              {doc.packageUrl && (
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="text-slate-500">
                    Have other separate company quotes for {doc.propertyAddress}?
                  </span>
                  <a
                    href={doc.packageUrl}
                    className="font-semibold text-slate-900 underline hover:text-slate-700"
                  >
                    Return to All Quotes Index →
                  </a>
                </div>
              )}
            </div>
          </section>
        )}

        {isDeclined && (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-xs text-rose-900">
            <div className="font-semibold">This independent quote was declined.</div>
            {doc.docDeclineReason && <p className="mt-1">Reason noted: {doc.docDeclineReason}</p>}
          </section>
        )}

        {/* Standalone Frozen Entity Document Snapshot */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <div
            className="cobid-doc-snapshot"
            dangerouslySetInnerHTML={{ __html: doc.snapshotHtml }}
          />
        </section>

        {/* E-Signature Panel */}
        {!isSigned && !isDeclined && (
          <section
            id="sign-panel"
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-md sm:p-7 text-xs"
          >
            <div className="flex items-start gap-2.5 border-b border-slate-100 pb-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-slate-900" />
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Accept &amp; Sign Directly with {doc.tradingName}
                </h2>
                <p className="mt-0.5 text-slate-600">
                  Executing this agreement creates a direct bilateral contract with{" "}
                  <strong>
                    {doc.legalEntityName} (ABN {doc.abn || "TBA"})
                  </strong>{" "}
                  for <strong>{formatAUD(doc.totalIncGst)}</strong> ({doc.depositPercent}% deposit:{" "}
                  {formatAUD(doc.depositAmount)}).
                </p>
              </div>
            </div>

            {actionError && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 font-medium text-rose-800">
                {actionError}
              </div>
            )}

            <form onSubmit={handleSign} className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block font-medium text-slate-700">Full Legal Name *</label>
                  <input
                    required
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="Type your full name"
                    className="mt-1 w-full font-serif text-base italic"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Email Address</label>
                  <input
                    type="email"
                    value={signerEmail}
                    onChange={(e) => setSignerEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">
                    Capacity / Authority (optional)
                  </label>
                  <input
                    value={signerCapacity}
                    onChange={(e) => setSignerCapacity(e.target.value)}
                    placeholder="e.g. Property Owner / Support Coordinator"
                    className="mt-1 w-full"
                  />
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <input
                  type="checkbox"
                  checked={legalAck}
                  onChange={(e) => setLegalAck(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span className="leading-relaxed text-slate-700">
                  I acknowledge this is a <strong>separate independent agreement</strong> directly
                  with <strong>{doc.legalEntityName}</strong> (not a partnership or subcontracting
                  arrangement), I accept the scope, pricing, and Terms &amp; Conditions above, and I
                  agree to sign electronically under the Electronic Transactions Act.
                </span>
              </label>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowDecline((v) => !v)}
                  className="text-xs font-medium text-slate-500 underline hover:text-rose-700"
                >
                  Decline this quote
                </button>
                <button
                  type="submit"
                  disabled={!legalAck || !signerName.trim() || submitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <FileSignature className="h-4 w-4" />
                  {submitting
                    ? "Signing & Generating Invoice…"
                    : `Accept & Sign ${doc.tradingName} Agreement`}
                </button>
              </div>
            </form>

            {showDecline && (
              <form
                onSubmit={handleDecline}
                className="mt-4 space-y-3 rounded-xl border border-rose-200 bg-rose-50/70 p-4"
              >
                <div className="font-semibold text-rose-900">
                  Decline {doc.tradingName} Quote Only
                </div>
                <textarea
                  rows={2}
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Optional reason or requested adjustment..."
                  className="w-full bg-white"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDecline(false)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg bg-rose-600 px-4 py-1.5 font-semibold text-white hover:bg-rose-700"
                  >
                    Confirm Decline
                  </button>
                </div>
              </form>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
