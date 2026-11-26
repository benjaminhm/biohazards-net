"use client";

import { CheckCircle2, CreditCard, Download, Landmark, Printer, ShieldCheck, X } from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import type { OpCoScope } from "@/lib/cobid/types";
import { calcTotals, formatAUD } from "@/lib/cobid/utils";

interface TaxInvoiceModalProps {
  opCo: OpCoScope | null;
  onClose: () => void;
}

export function TaxInvoiceModal({ opCo, onClose }: TaxInvoiceModalProps) {
  const { activeJob, role, payOpCoBalance } = useWorkspace();

  if (!opCo || !activeJob) return null;

  const totals = calcTotals(opCo.lineItems, opCo.depositPercent, opCo.variations);
  const approvedVars = opCo.variations.filter((v) => v.status === "approved");
  const depositPaidAmount = opCo.depositStatus === "paid" ? totals.depositAmount : 0;
  const amountDueNow =
    opCo.balanceStatus === "paid" ? 0 : totals.totalIncGst - depositPaidAmount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="no-print flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-3.5">
          <div className="text-xs font-semibold text-slate-700">
            Individual Tax Invoice · {opCo.balanceInvoiceRef}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/api/cobid/workspaces/${activeJob.id}/pdf?type=invoice&opCoId=${opCo.id}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800"
            >
              <Download className="h-3.5 w-3.5" />
              Download PDF
            </a>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Printer className="h-3.5 w-3.5" />
              Print
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-6 p-6 text-xs">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                TAX INVOICE (ISSUED DIRECTLY BY OPERATING COMPANY)
              </div>
              <h3 className="mt-1 text-lg font-bold text-slate-900">
                {opCo.companyName}
              </h3>
              <div className="mt-0.5 text-slate-600">
                ABN: <strong>{opCo.abn}</strong> · Licence: {opCo.licenceNumber}
              </div>
              <div className="text-slate-500">
                {opCo.contactName} · {opCo.contactEmail}
              </div>
            </div>
            <div className="text-left sm:text-right">
              <div className="font-mono text-sm font-bold text-slate-900">
                {opCo.balanceInvoiceRef}
              </div>
              <div className="mt-0.5 text-slate-500">
                Agreement Ref: {opCo.agreementRef}
              </div>
              <div className="text-slate-500">Workspace: {activeJob.reference}</div>
              <div className="mt-2">
                {opCo.balanceStatus === "paid" ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    PAID IN FULL
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                    BALANCE DUE: {formatAUD(amountDueNow)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Bill To
              </div>
              <div className="mt-1 font-semibold text-slate-900">
                {activeJob.clientName}
              </div>
              <div className="text-slate-600">{activeJob.clientEmail}</div>
              <div className="text-slate-600">
                Site: {activeJob.propertyAddress}, {activeJob.suburbState}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <Landmark className="h-3.5 w-3.5" />
                {activeJob.settlementRail === "direct_to_opco"
                  ? "Direct-to-OpCo EFT / PayID"
                  : "Trust Clearing Disbursement"}
              </div>
              {activeJob.settlementRail === "direct_to_opco" ? (
                <div className="mt-1 space-y-0.5 text-[11px] text-slate-700">
                  <div>
                    <strong>{opCo.companyName}</strong> ({opCo.bankName})
                  </div>
                  <div>
                    BSB: {opCo.bsb} · Acc: {opCo.accountNumber}
                  </div>
                  <div>PayID: {opCo.payId}</div>
                </div>
              ) : (
                <div className="mt-1 text-[11px] text-slate-700">
                  Settle via Statutory Trust Clearing Sub-Ledger {opCo.monogram} → auto-disbursed to{" "}
                  <strong>{opCo.companyName}</strong>.
                </div>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-left">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Ex GST</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {opCo.lineItems.map((li) => (
                  <tr key={li.id}>
                    <td className="px-3 py-2 text-slate-800">
                      <span className="mr-1.5 font-mono text-[10px] text-slate-400">
                        {li.code}
                      </span>
                      {li.description}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">{li.qty}</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-900">
                      {formatAUD(li.qty * li.unitPrice)}
                    </td>
                  </tr>
                ))}
                {approvedVars.map((v) => (
                  <tr key={v.id} className="bg-indigo-50/40">
                    <td className="px-3 py-2 text-slate-800">
                      <span className="mr-1.5 rounded bg-indigo-100 px-1 py-0.5 font-mono text-[10px] font-semibold text-indigo-800">
                        {v.reference}
                      </span>
                      Variation: {v.title}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">1</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-900">
                      {formatAUD(v.amountExGst)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ml-auto max-w-xs space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal (ex GST)</span>
              <span>{formatAUD(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>GST (10%)</span>
              <span>{formatAUD(totals.gst)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold text-slate-900">
              <span>Total Contract Value</span>
              <span>{formatAUD(totals.totalIncGst)}</span>
            </div>
            <div className="flex justify-between text-emerald-700">
              <span>
                Less Deposit{" "}
                {opCo.depositStatus === "paid" ? `(Ref ${opCo.depositPaymentRef})` : "(Unpaid)"}
              </span>
              <span>-{formatAUD(depositPaidAmount)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-300 pt-2 text-sm font-bold text-slate-900">
              <span>Final Balance Due</span>
              <span>{formatAUD(amountDueNow)}</span>
            </div>
          </div>

          {opCo.balanceStatus === "paid" && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
              <strong>Final Balance Settled:</strong> {opCo.balancePaidAt} · Ref{" "}
              {opCo.balancePaymentRef}
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span>
              This Tax Invoice is issued solely by <strong>{opCo.companyName}</strong> (ABN{" "}
              {opCo.abn}). Hazmat Management Co-Bid facilitates workspace settlement only and is not
              the supplier of these remediation services.
            </span>
          </div>
        </div>

        <div className="no-print flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700"
          >
            Close
          </button>
          {opCo.balanceStatus !== "paid" &&
            (role.type === "client" || role.type === "coordinator") && (
              <button
                onClick={() => payOpCoBalance(opCo.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                <CreditCard className="h-4 w-4" />
                Settle Final Balance ({formatAUD(amountDueNow)}) Directly to {opCo.monogram}
              </button>
            )}
        </div>
      </div>
    </div>
  );
}
