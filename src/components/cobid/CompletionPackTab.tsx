"use client";

import { useState } from "react";
import {
  Award,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Printer,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import { calcTotals, formatAUD } from "@/lib/cobid/utils";
import { TaxInvoiceModal } from "./TaxInvoiceModal";

export function CompletionPackTab() {
  const { activeJob, role, signOffCompletion, attachComplianceDoc } = useWorkspace();
  const [notesByOpCo, setNotesByOpCo] = useState<Record<string, string>>({});
  const [invoiceOpCoId, setInvoiceOpCoId] = useState<string | null>(null);
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null);

  if (!activeJob) return null;

  const handleDocUpload = async (opCoId: string, docId: string, file: File) => {
    setUploadingDocId(docId);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/cobid/uploads", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const data = (await res.json()) as { url: string; filename: string };
      await attachComplianceDoc(opCoId, docId, data.url, data.filename);
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingDocId(null);
    }
  };

  const invoiceOpCo = invoiceOpCoId
    ? activeJob.opCos.find((o) => o.id === invoiceOpCoId) ?? null
    : null;

  const visibleOpCos =
    role.type === "contractor"
      ? activeJob.opCos.filter((o) => o.id === role.opCoId)
      : activeJob.opCos;

  const allCompleted = activeJob.opCos.every((o) => o.completionSignedOff);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Consolidated Completion & Compliance Pack
          </h2>
          <p className="text-xs text-slate-500">
            Each OpCo certifies completion and issues compliance documentation for their own scope. Rolled into one clean handover report for the client, NDIS coordinator, or insurer.
          </p>
        </div>
        <div className="no-print flex items-center gap-2 self-start">
          <a
            href={`/api/cobid/workspaces/${activeJob.id}/pdf?type=completion`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800"
          >
            <Download className="h-4 w-4" />
            Download Completion Pack PDF
          </a>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Hazmat Management Co-Bid Handover Dossier · {activeJob.reference}
            </div>
            <h3 className="mt-1 text-lg font-bold text-slate-900">
              {activeJob.propertyAddress}, {activeJob.suburbState}
            </h3>
            <div className="mt-1 text-xs text-slate-600">
              Client: <strong>{activeJob.clientName}</strong> · Lead Origin:{" "}
              <strong>{activeJob.leadSource}</strong>
            </div>
          </div>
          <div
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
              allCompleted
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {allCompleted ? (
              <>
                <Award className="h-4 w-4" />
                All Scopes Certified Complete
              </>
            ) : (
              <>
                <Clock className="h-4 w-4" />
                {activeJob.opCos.filter((o) => o.completionSignedOff).length} of{" "}
                {activeJob.opCos.length} OpCo Scopes Signed Off
              </>
            )}
          </div>
        </div>

        <div className="mt-5 space-y-5">
          {visibleOpCos.map((opCo) => {
            const totals = calcTotals(opCo.lineItems, opCo.depositPercent, opCo.variations);
            const canSignOff =
              !opCo.completionSignedOff &&
              (role.type === "coordinator" ||
                (role.type === "contractor" && role.opCoId === opCo.id));

            return (
              <div
                key={opCo.id}
                className="rounded-xl border border-slate-200 bg-slate-50/50 p-5"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                        Stage {opCo.sequenceOrder}
                      </span>
                      <h4 className="text-sm font-semibold text-slate-900">
                        {opCo.companyName}
                      </h4>
                      <span className="text-xs text-slate-500">
                        (ABN {opCo.abn})
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {opCo.tradeCategory} · Agreement {opCo.agreementRef} · Contract Total{" "}
                      {formatAUD(totals.totalIncGst)} (inc. GST)
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setInvoiceOpCoId(opCo.id)}
                      className="no-print inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Tax Invoice ({opCo.balanceStatus === "paid" ? "Paid" : "Balance Due"})
                    </button>
                    {opCo.completionSignedOff ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Certified Complete · {opCo.completionSignedAt}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                        Pending OpCo Completion Sign-Off
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {opCo.complianceDocs.map((doc) => {
                    const canUploadDoc =
                      role.type === "coordinator" ||
                      (role.type === "contractor" && role.opCoId === opCo.id);
                    return (
                      <div
                        key={doc.id}
                        className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs"
                      >
                        <div className="flex items-start gap-2.5">
                          <FileCheck2
                            className={`mt-0.5 h-4 w-4 shrink-0 ${
                              doc.status === "verified"
                                ? "text-emerald-600"
                                : "text-slate-400"
                            }`}
                          />
                          <div>
                            <div className="font-medium text-slate-900">{doc.title}</div>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              Ref: {doc.reference} · Issued: {doc.issuedAt}
                            </div>
                            {doc.fileUrl && (
                              <a
                                href={doc.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" />
                                View Uploaded Document
                              </a>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                              doc.status === "verified"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {doc.status}
                          </span>
                          {canUploadDoc && (
                            <label className="no-print inline-flex cursor-pointer items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-100">
                              <Upload className="h-2.5 w-2.5" />
                              {uploadingDocId === doc.id ? "Uploading…" : "Upload File"}
                              <input
                                type="file"
                                accept="image/*,application/pdf"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleDocUpload(opCo.id, doc.id, f);
                                }}
                              />
                            </label>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {opCo.completionNotes && (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5 text-xs text-emerald-900">
                    <strong>OpCo Completion Statement:</strong> {opCo.completionNotes}
                  </div>
                )}

                {canSignOff && (
                  <div className="no-print mt-4 flex flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-row">
                    <input
                      type="text"
                      placeholder={`Enter completion certification notes for ${opCo.companyName}...`}
                      value={notesByOpCo[opCo.id] ?? ""}
                      onChange={(e) =>
                        setNotesByOpCo((prev) => ({
                          ...prev,
                          [opCo.id]: e.target.value,
                        }))
                      }
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                    />
                    <button
                      onClick={() =>
                        signOffCompletion(
                          opCo.id,
                          notesByOpCo[opCo.id]?.trim() ||
                            `All ${opCo.tradeCategory} deliverables completed in accordance with Agreement ${opCo.agreementRef}.`
                        )
                      }
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Certify Scope Complete & Issue Docs
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-[11px] text-slate-500">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <p>
            <strong>Legal Separation Notice:</strong> This dossier compiles independent completion
            certifications for convenience. Each Operating Company remains solely responsible and
            liable for the workmanship, statutory warranties, and regulatory compliance of its own
            contracted scope.
          </p>
        </div>
      </div>

      <TaxInvoiceModal opCo={invoiceOpCo} onClose={() => setInvoiceOpCoId(null)} />
    </div>
  );
}
