"use client";

import { useState } from "react";
import {
  Building2,
  CheckCircle2,
  CreditCard,
  Download,
  FileSignature,
  FileText,
  Landmark,
  Lock,
  Scale,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import type { OpCoScope } from "@/lib/cobid/types";
import { calcTotals, formatAUD } from "@/lib/cobid/utils";
import { AgreementBadge, DepositBadge } from "./StatusBadge";
import { TaxInvoiceModal } from "./TaxInvoiceModal";

export function AgreementsDepositsTab() {
  const {
    activeJob,
    role,
    setSettlementRail,
    sendAgreementToClient,
    signOpCoAgreement,
    payOpCoDeposit,
  } = useWorkspace();

  const [signingOpCo, setSigningOpCo] = useState<OpCoScope | null>(null);
  const [signerName, setSignerName] = useState(activeJob?.clientName ?? "");
  const [legalAck, setLegalAck] = useState(false);

  const [payingOpCo, setPayingOpCo] = useState<OpCoScope | null>(null);
  const [invoiceOpCoId, setInvoiceOpCoId] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<
    "Bank Transfer / PayID" | "Direct Card (OpCo Merchant)" | "Trust Clearing Allocation"
  >("Bank Transfer / PayID");

  if (!activeJob) return null;

  const invoiceOpCo = invoiceOpCoId
    ? activeJob.opCos.find((o) => o.id === invoiceOpCoId) ?? null
    : null;

  const visibleOpCos =
    role.type === "contractor"
      ? activeJob.opCos.filter((o) => o.id === role.opCoId)
      : activeJob.opCos;

  const openSignModal = (opCo: OpCoScope) => {
    setSigningOpCo(opCo);
    setSignerName(activeJob.clientName);
    setLegalAck(false);
  };

  const openPayModal = (opCo: OpCoScope) => {
    setPayingOpCo(opCo);
    setPayMethod(
      activeJob.settlementRail === "trust_clearing"
        ? "Trust Clearing Allocation"
        : "Bank Transfer / PayID"
    );
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-800">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Individual Legal Agreements & Direct-to-OpCo Deposits
              </h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">
                Every agreement is issued, executed, and settled{" "}
                <strong className="text-slate-900">individually per Operating Company</strong>.
                Hazmat Management Co-Bid is a neutral workspace facilitator — never a head
                contractor, partner, or subcontracting intermediary.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Settlement Rail
              </span>
              {role.type !== "coordinator" && (
                <span className="text-[10px] text-slate-400">Configured by Platform</span>
              )}
            </div>
            <div className="flex gap-1.5">
              <button
                disabled={role.type !== "coordinator"}
                onClick={() => setSettlementRail("direct_to_opco")}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                  activeJob.settlementRail === "direct_to_opco"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                }`}
              >
                Direct to OpCo
              </button>
              <button
                disabled={role.type !== "coordinator"}
                onClick={() => setSettlementRail("trust_clearing")}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                  activeJob.settlementRail === "trust_clearing"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                }`}
              >
                Trust Clearing → OpCos
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {visibleOpCos.map((opCo) => {
          const totals = calcTotals(opCo.lineItems, opCo.depositPercent, opCo.variations);
          const isSigned = opCo.agreementStatus === "signed";
          const isPaid = opCo.depositStatus === "paid";

          return (
            <div
              key={opCo.id}
              className="flex flex-col justify-between overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs"
            >
              <div>
                <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800">
                        {opCo.monogram}
                      </div>
                      <div>
                        <div className="text-[11px] font-medium text-slate-500">
                          Stage {opCo.sequenceOrder} · {opCo.tradeCategory}
                        </div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          {opCo.companyName}
                        </h3>
                        <div className="text-[11px] text-slate-500">
                          ABN {opCo.abn} · Agreement Ref: {opCo.agreementRef}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-b border-slate-100 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                      <FileSignature className="h-4 w-4 text-slate-500" />
                      1. Individual Service Agreement
                    </div>
                    <AgreementBadge status={opCo.agreementStatus} />
                  </div>

                  <div className="mt-2 flex items-start justify-between gap-2">
                    <p className="text-xs text-slate-600">
                      Direct bilateral contract between{" "}
                      <strong className="text-slate-800">{activeJob.clientName}</strong> and{" "}
                      <strong className="text-slate-800">{opCo.companyName}</strong> for{" "}
                      {formatAUD(totals.totalIncGst)} (inc. GST).
                    </p>
                    {!isSigned && opCo.scopeStatus === "contractor_approved" && (
                      <a
                        href={`/api/cobid/workspaces/${activeJob.id}/pdf?type=agreement&opCoId=${opCo.id}`}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                        title="Download Agreement PDF"
                      >
                        <Download className="h-3 w-3" />
                        PDF
                      </a>
                    )}
                  </div>

                  {isSigned ? (
                    <div className="mt-3 flex flex-col gap-2">
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-900">
                        <div className="flex items-center gap-1.5 font-semibold">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          Executed by {opCo.clientSignedBy}
                        </div>
                        <div className="mt-1 text-[11px] text-emerald-800">
                          Signed {opCo.clientSignedAt} · Audit {opCo.agreementAuditHash}
                        </div>
                      </div>
                      <a
                        href={`/api/cobid/workspaces/${activeJob.id}/pdf?type=agreement&opCoId=${opCo.id}`}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download Executed Agreement PDF ({opCo.agreementRef})
                      </a>
                    </div>
                  ) : (
                    <div className="mt-3">
                      {opCo.agreementStatus === "not_ready" && (
                        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                          <Lock className="h-3.5 w-3.5" />
                          Awaiting {opCo.companyName} to approve their scope & estimate first.
                        </div>
                      )}
                      {opCo.agreementStatus === "ready_to_send" &&
                        role.type === "coordinator" && (
                          <button
                            onClick={() => sendAgreementToClient(opCo.id)}
                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800"
                          >
                            <Send className="h-3.5 w-3.5" />
                            Send Individual Agreement to Client
                          </button>
                        )}
                      {opCo.agreementStatus === "ready_to_send" &&
                        role.type !== "coordinator" && (
                          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                            Scope approved by OpCo. Scoping Desk will issue individual agreement shortly.
                          </div>
                        )}
                      {opCo.agreementStatus === "sent_to_client" &&
                        role.type === "client" && (
                          <button
                            onClick={() => openSignModal(opCo)}
                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800"
                          >
                            <FileSignature className="h-4 w-4" />
                            Review & E-Sign {opCo.companyName} Agreement
                          </button>
                        )}
                      {opCo.agreementStatus === "sent_to_client" &&
                        role.type !== "client" && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            Issued to {activeJob.clientName} on {opCo.agreementSentAt}. Awaiting
                            client e-signature.
                          </div>
                        )}
                    </div>
                  )}
                </div>

                <div className="p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                      <Landmark className="h-4 w-4 text-slate-500" />
                      2. Individual Deposit ({opCo.depositPercent}%)
                    </div>
                    <DepositBadge status={opCo.depositStatus} />
                  </div>

                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">Deposit Payable</span>
                      <span className="text-sm font-bold text-slate-900">
                        {formatAUD(totals.depositAmount)}
                      </span>
                    </div>
                    <div className="mt-2 border-t border-slate-200 pt-2 text-[11px] text-slate-600">
                      {activeJob.settlementRail === "direct_to_opco" ? (
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-800">
                            Direct Beneficiary: {opCo.companyName}
                          </div>
                          <div>
                            {opCo.bankName} · BSB {opCo.bsb} · Acc {opCo.accountNumber}
                          </div>
                          <div>PayID: {opCo.payId}</div>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-800">
                            Statutory Clearing Trust (Sub-Ledger {opCo.monogram})
                          </div>
                          <div>
                            Auto-disburses {formatAUD(totals.depositAmount)} directly to{" "}
                            {opCo.companyName} (ABN {opCo.abn}) on contract execution.
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {isPaid ? (
                    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-900">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        Settled ({opCo.depositMethod})
                      </div>
                      <div className="mt-1 text-[11px] text-emerald-800">
                        Ref: {opCo.depositPaymentRef} · {opCo.depositPaidAt}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3">
                      {!isSigned ? (
                        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                          <Lock className="h-3.5 w-3.5" />
                          Unlocks immediately after {opCo.companyName} agreement is signed.
                        </div>
                      ) : role.type === "client" || role.type === "coordinator" ? (
                        <button
                          onClick={() => openPayModal(opCo)}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800"
                        >
                          <CreditCard className="h-4 w-4" />
                          {activeJob.settlementRail === "direct_to_opco"
                            ? `Record / Pay ${formatAUD(totals.depositAmount)} Directly to ${opCo.companyName}`
                            : `Fund Trust Clearing (${formatAUD(totals.depositAmount)}) for ${opCo.monogram}`}
                        </button>
                      ) : (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          Agreement executed. Awaiting client deposit settlement directly to{" "}
                          {opCo.companyName}.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-100 bg-slate-50/50 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                      <FileText className="h-4 w-4 text-slate-500" />
                      3. Final Balance & Tax Invoice ({opCo.balanceInvoiceRef})
                    </div>
                    {opCo.balanceStatus === "paid" ? (
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                        Paid in Full
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-slate-700">
                        {formatAUD(totals.balanceAmount)} due on completion
                      </span>
                    )}
                  </div>
                  {totals.approvedVariationsExGst > 0 && (
                    <div className="mt-1.5 text-[11px] text-indigo-700">
                      Includes {formatAUD(totals.approvedVariationsExGst * 1.1)} (inc. GST) in
                      approved variations for {opCo.monogram}.
                    </div>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setInvoiceOpCoId(opCo.id)}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      View Tax Invoice
                    </button>
                    <a
                      href={`/api/cobid/workspaces/${activeJob.id}/pdf?type=invoice&opCoId=${opCo.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      <Download className="h-3.5 w-3.5" />
                      PDF
                    </a>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <TaxInvoiceModal opCo={invoiceOpCo} onClose={() => setInvoiceOpCoId(null)} />

      {signingOpCo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Independent Contractor Agreement · {signingOpCo.agreementRef}
                </div>
                <h3 className="text-base font-semibold text-slate-900">
                  {signingOpCo.companyName} (ABN {signingOpCo.abn})
                </h3>
              </div>
              <button
                onClick={() => setSigningOpCo(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-6 text-xs leading-relaxed text-slate-700">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <ShieldCheck className="h-4 w-4 text-slate-700" />
                  Clause 1 — Independent Contracting Party (No Joint Venture / Subcontract)
                </div>
                <p className="mt-1.5 text-slate-600">
                  This Agreement is entered into directly and solely between{" "}
                  <strong>{activeJob.clientName}</strong> (&ldquo;Client&rdquo;) and{" "}
                  <strong>
                    {signingOpCo.companyName} (ABN {signingOpCo.abn})
                  </strong>{" "}
                  (&ldquo;Contractor&rdquo;) for the discrete scope of{" "}
                  <strong>{signingOpCo.tradeCategory}</strong> at{" "}
                  <strong>
                    {activeJob.propertyAddress}, {activeJob.suburbState}
                  </strong>
                  . Neither Hazmat Management Co-Bid nor any other contractor operating in this
                  workspace is a party, partner, agent, or head contractor to this Agreement.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 p-4">
                <div className="font-semibold text-slate-900">
                  Clause 2 — Approved Scope & Consideration
                </div>
                <p className="mt-1 text-slate-600">{signingOpCo.scopeSummary}</p>
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 font-semibold text-slate-900">
                  <span>Contract Price (inc. GST)</span>
                  <span>
                    {formatAUD(
                      calcTotals(signingOpCo.lineItems, signingOpCo.depositPercent).totalIncGst
                    )}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-slate-600">
                  <span>Direct Deposit ({signingOpCo.depositPercent}%)</span>
                  <span>
                    {formatAUD(
                      calcTotals(signingOpCo.lineItems, signingOpCo.depositPercent).depositAmount
                    )}
                  </span>
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <input
                  type="checkbox"
                  checked={legalAck}
                  onChange={(e) => setLegalAck(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span className="text-slate-700">
                  I acknowledge this is a <strong>separate legal agreement</strong> directly with{" "}
                  <strong>{signingOpCo.companyName}</strong> and agree to execute it electronically
                  under the Electronic Transactions Act.
                </span>
              </label>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Type Full Legal Name to E-Sign
                </label>
                <input
                  type="text"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-serif text-lg italic text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button
                onClick={() => setSigningOpCo(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                disabled={!legalAck || !signerName.trim()}
                onClick={() => {
                  signOpCoAgreement(signingOpCo.id, signerName.trim());
                  setSigningOpCo(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FileSignature className="h-4 w-4" />
                Execute Agreement with {signingOpCo.monogram}
              </button>
            </div>
          </div>
        </div>
      )}

      {payingOpCo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {activeJob.settlementRail === "direct_to_opco"
                    ? "Direct-to-OpCo Deposit Settlement"
                    : "Statutory Trust Clearing Allocation"}
                </div>
                <h3 className="text-base font-semibold text-slate-900">
                  {payingOpCo.companyName}
                </h3>
              </div>
              <button
                onClick={() => setPayingOpCo(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-6 text-xs">
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <div className="text-slate-500">
                    {payingOpCo.depositPercent}% Deposit ({payingOpCo.agreementRef})
                  </div>
                  <div className="text-xs text-slate-500">ABN {payingOpCo.abn}</div>
                </div>
                <div className="text-xl font-bold text-slate-900">
                  {formatAUD(
                    calcTotals(payingOpCo.lineItems, payingOpCo.depositPercent).depositAmount
                  )}
                </div>
              </div>

              {activeJob.settlementRail === "direct_to_opco" ? (
                <div className="space-y-2">
                  <div className="font-semibold text-slate-800">
                    Select Direct Payment Method to {payingOpCo.companyName}
                  </div>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                    <input
                      type="radio"
                      checked={payMethod === "Bank Transfer / PayID"}
                      onChange={() => setPayMethod("Bank Transfer / PayID")}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="font-semibold text-slate-900">
                        NPP Bank Transfer / PayID (Direct to OpCo)
                      </div>
                      <div className="mt-0.5 text-slate-500">
                        {payingOpCo.bankName} · BSB {payingOpCo.bsb} · Acc{" "}
                        {payingOpCo.accountNumber} · PayID {payingOpCo.payId}
                      </div>
                    </div>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                    <input
                      type="radio"
                      checked={payMethod === "Direct Card (OpCo Merchant)"}
                      onChange={() => setPayMethod("Direct Card (OpCo Merchant)")}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="font-semibold text-slate-900">
                        Direct Card via OpCo Connected Merchant Account
                      </div>
                      <div className="mt-0.5 text-slate-500">
                        Funds settle directly to {payingOpCo.companyName} (no platform commingling).
                      </div>
                    </div>
                  </label>
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-slate-700">
                  <div className="flex items-center gap-2 font-semibold text-slate-900">
                    <Building2 className="h-4 w-4" />
                    Statutory Trust Clearing Account
                  </div>
                  <p className="mt-1 text-slate-600">
                    Funds land in the regulated clearing trust and are earmarked exclusively for{" "}
                    <strong>{payingOpCo.companyName}</strong> ({payingOpCo.bankName} BSB{" "}
                    {payingOpCo.bsb}) under Agreement {payingOpCo.agreementRef}.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button
                onClick={() => setPayingOpCo(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  payOpCoDeposit(payingOpCo.id, payMethod);
                  setPayingOpCo(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                <CheckCircle2 className="h-4 w-4" />
                Confirm Deposit Settlement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
