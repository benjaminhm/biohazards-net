"use client";

import { useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCheck2,
  Link2,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import { calcTotals, formatAUD } from "@/lib/cobid/utils";
import { QUOTE_TYPE_META } from "@/lib/cobid/types";
import { AgreementBadge, ScopeBadge } from "./StatusBadge";

export function ScopesEstimatesTab({
  onNavigateTab,
}: {
  onNavigateTab: (tab: string) => void;
}) {
  const {
    activeJob,
    role,
    addLineItem,
    removeLineItem,
    sendScopeToContractor,
    approveScopeAsContractor,
    requestScopeRevision,
    sendAgreementToClient,
    issueBidInvite,
  } = useWorkspace();

  const [addingForOpCo, setAddingForOpCo] = useState<string | null>(null);
  const [newDesc, setNewDesc] = useState("");
  const [newUnit, setNewUnit] = useState("Allow");
  const [newQty, setNewQty] = useState("1");
  const [newPrice, setNewPrice] = useState("350");

  const [revisionOpCoId, setRevisionOpCoId] = useState<string | null>(null);
  const [revisionText, setRevisionText] = useState("");

  const [issuingBidFor, setIssuingBidFor] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [bidNotice, setBidNotice] = useState<Record<string, string>>({});

  if (!activeJob) return null;

  const visibleOpCos =
    role.type === "contractor"
      ? activeJob.opCos.filter((o) => o.id === role.opCoId)
      : activeJob.opCos;

  const handleAddLineItem = (opCoId: string) => {
    if (!newDesc.trim()) return;
    addLineItem(opCoId, {
      code: `ADD-${Math.floor(100 + Math.random() * 900)}`,
      description: newDesc.trim(),
      unit: newUnit.trim() || "Allow",
      qty: Math.max(1, Number(newQty) || 1),
      unitPrice: Math.max(0, Number(newPrice) || 0),
      category: "Scoping Addition",
    });
    setNewDesc("");
    setNewQty("1");
    setNewPrice("350");
    setAddingForOpCo(null);
  };

  const handleIssueBidInvite = async (opCoId: string) => {
    setIssuingBidFor(opCoId);
    try {
      const res = await issueBidInvite(opCoId, true);
      navigator.clipboard.writeText(res.bidUrl).catch(() => {});
      setCopiedId(opCoId);
      setTimeout(() => setCopiedId((c) => (c === opCoId ? null : c)), 2500);
      setBidNotice((prev) => ({
        ...prev,
        [opCoId]: res.emailSent
          ? "Quote Builder link emailed & copied to clipboard."
          : `Quote Builder link copied to clipboard (${res.emailError || "ready to share"}).`,
      }));
    } catch (err) {
      setBidNotice((prev) => ({
        ...prev,
        [opCoId]: err instanceof Error ? err.message : "Failed to issue bid link",
      }));
    } finally {
      setIssuingBidFor(null);
    }
  };

  const copyBidUrl = (opCoId: string, url: string) => {
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedId(opCoId);
    setTimeout(() => setCopiedId((c) => (c === opCoId ? null : c)), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Independent BCQ / SACQ Scopes &amp; Individual Estimates
          </h2>
          <p className="text-xs text-slate-500">
            Invite each approved operator to their dedicated ring-fenced BCQ/SACQ quote builder
            page, or draft and submit for OpCo lock before dispatching separate client documents.
          </p>
        </div>
      </div>

      {visibleOpCos.map((opCo) => {
        const totals = calcTotals(opCo.lineItems, opCo.depositPercent);
        const qtMeta = QUOTE_TYPE_META[opCo.quoteType] ?? QUOTE_TYPE_META.custom;
        const canEditEstimate =
          role.type === "coordinator" && opCo.agreementStatus !== "signed";
        const isThisContractor =
          role.type === "contractor" && role.opCoId === opCo.id;

        return (
          <div
            key={opCo.id}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs"
          >
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800">
                  {opCo.monogram}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                      Stage {opCo.sequenceOrder}
                    </span>
                    <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-indigo-800">
                      {qtMeta.code}
                    </span>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {opCo.companyName}
                    </h3>
                    <span className="text-xs text-slate-500">
                      · {opCo.tradeCategory}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    ABN {opCo.abn} · Independent Job:{" "}
                    <span className="font-mono font-medium text-slate-700">
                      {opCo.independentJobRef || opCo.agreementRef}
                    </span>{" "}
                    · {qtMeta.label}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ScopeBadge status={opCo.scopeStatus} />
                <AgreementBadge status={opCo.agreementStatus} />
              </div>
            </div>

            {/* Coordinator BCQ/SACQ Bid Builder Link Bar */}
            {role.type === "coordinator" && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/40 px-5 py-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2 text-slate-600">
                  <Link2 className="h-3.5 w-3.5 text-slate-500" />
                  <span className="font-medium text-slate-800">
                    OpCo {qtMeta.code} Quote Builder:
                  </span>
                  {opCo.bidUrl ? (
                    <>
                      <a
                        href={opCo.bidUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-indigo-700 underline hover:text-indigo-900"
                      >
                        Open Builder
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <button
                        type="button"
                        onClick={() => copyBidUrl(opCo.id, opCo.bidUrl!)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {copiedId === opCo.id ? (
                          <Check className="h-3 w-3 text-emerald-600" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {copiedId === opCo.id ? "Copied" : "Copy Link"}
                      </button>
                    </>
                  ) : (
                    <span className="text-[11px] text-slate-500">Not issued yet</span>
                  )}
                  {bidNotice[opCo.id] && (
                    <span className="text-[11px] font-medium text-emerald-700">
                      {bidNotice[opCo.id]}
                    </span>
                  )}
                </div>

                {opCo.agreementStatus !== "signed" && (
                  <button
                    type="button"
                    disabled={issuingBidFor === opCo.id}
                    onClick={() => handleIssueBidInvite(opCo.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                  >
                    <Send className="h-3 w-3" />
                    {issuingBidFor === opCo.id
                      ? "Sending…"
                      : opCo.bidUrl
                        ? `Resend ${qtMeta.code} Bid Link`
                        : `Email & Copy ${qtMeta.code} Bid Link`}
                  </button>
                )}
              </div>
            )}

            {opCo.scopeStatus === "revision_requested" && opCo.revisionNote && (
              <div className="flex items-start gap-2.5 border-b border-rose-200 bg-rose-50 px-5 py-3 text-xs text-rose-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <span className="font-semibold">OpCo Revision Requested: </span>
                  {opCo.revisionNote}
                </div>
              </div>
            )}

            <div className="grid gap-6 border-b border-slate-100 p-5 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Approved Scope of Works
                </h4>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">
                  {opCo.scopeSummary}
                </p>
                <ul className="mt-3 space-y-1.5">
                  {opCo.scopeDeliverables.map((d, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2 text-xs text-slate-700"
                    >
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Boundary & Exclusions
                </h4>
                <p className="mt-1 text-[11px] text-slate-500">
                  Clearly demarcates liability between independent OpCos:
                </p>
                <ul className="mt-2.5 space-y-1.5">
                  {opCo.exclusions.map((ex, idx) => (
                    <li key={idx} className="text-xs text-slate-600">
                      • {ex}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Line-Item Estimate (AUD, Excl. GST)
                </h4>
                {canEditEstimate && (
                  <button
                    onClick={() =>
                      setAddingForOpCo(addingForOpCo === opCo.id ? null : opCo.id)
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Line Item
                  </button>
                )}
              </div>

              {addingForOpCo === opCo.id && (
                <div className="mb-4 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-12">
                  <input
                    type="text"
                    placeholder="Line item description..."
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs sm:col-span-5"
                  />
                  <input
                    type="text"
                    placeholder="Unit"
                    value={newUnit}
                    onChange={(e) => setNewUnit(e.target.value)}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs sm:col-span-2"
                  />
                  <input
                    type="number"
                    placeholder="Qty"
                    value={newQty}
                    onChange={(e) => setNewQty(e.target.value)}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs sm:col-span-1"
                  />
                  <input
                    type="number"
                    placeholder="Rate"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs sm:col-span-2"
                  />
                  <button
                    onClick={() => handleAddLineItem(opCo.id)}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 sm:col-span-2"
                  >
                    Save Item
                  </button>
                </div>
              )}

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5 font-medium">Code</th>
                      <th className="px-3 py-2.5 font-medium">Description</th>
                      <th className="px-3 py-2.5 font-medium">Unit</th>
                      <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                      <th className="px-3 py-2.5 text-right font-medium">Rate</th>
                      <th className="px-3 py-2.5 text-right font-medium">Total</th>
                      {canEditEstimate && <th className="w-8 px-2 py-2.5" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {opCo.lineItems.map((li) => (
                      <tr key={li.id} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500">
                          {li.code}
                        </td>
                        <td className="px-3 py-2.5 text-slate-800">{li.description}</td>
                        <td className="px-3 py-2.5 text-slate-500">{li.unit}</td>
                        <td className="px-3 py-2.5 text-right text-slate-700">{li.qty}</td>
                        <td className="px-3 py-2.5 text-right text-slate-700">
                          {formatAUD(li.unitPrice)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium text-slate-900">
                          {formatAUD(li.qty * li.unitPrice)}
                        </td>
                        {canEditEstimate && (
                          <td className="px-2 py-2.5 text-right">
                            <button
                              onClick={() => removeLineItem(opCo.id, li.id)}
                              className="text-slate-400 hover:text-rose-600"
                              title="Remove item"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1 text-xs text-slate-500">
                  {opCo.contractorApprovedAt && (
                    <div className="flex items-center gap-1.5 text-emerald-700">
                      <FileCheck2 className="h-3.5 w-3.5" />
                      <span>
                        Approved by {opCo.contactName} ({opCo.companyName}) on{" "}
                        {opCo.contractorApprovedAt}
                      </span>
                    </div>
                  )}
                  <div>
                    Direct Deposit Required ({opCo.depositPercent}%):{" "}
                    <strong className="text-slate-800">
                      {formatAUD(totals.depositAmount)}
                    </strong>{" "}
                    payable directly to {opCo.companyName}
                  </div>
                </div>

                <div className="w-full max-w-xs space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal (ex GST)</span>
                    <span>{formatAUD(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>GST (10%)</span>
                    <span>{formatAUD(totals.gst)}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-1.5 text-sm font-bold text-slate-900">
                    <span>Total (inc. GST)</span>
                    <span>{formatAUD(totals.totalIncGst)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
                {role.type === "coordinator" &&
                  (opCo.scopeStatus === "draft" ||
                    opCo.scopeStatus === "revision_requested") && (
                    <button
                      onClick={() => sendScopeToContractor(opCo.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Submit Scope & Estimate to {opCo.monogram} for Approval
                    </button>
                  )}

                {role.type === "coordinator" &&
                  opCo.scopeStatus === "contractor_approved" &&
                  opCo.agreementStatus === "ready_to_send" && (
                    <button
                      onClick={() => sendAgreementToClient(opCo.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-800"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Issue Individual Agreement ({opCo.agreementRef}) to Client
                    </button>
                  )}

                {isThisContractor && opCo.scopeStatus === "pending_contractor" && (
                  <>
                    {revisionOpCoId === opCo.id ? (
                      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          type="text"
                          value={revisionText}
                          onChange={(e) => setRevisionText(e.target.value)}
                          placeholder="Note for Scoping Desk (e.g. add 1 day hydroxyl hire)..."
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs"
                        />
                        <button
                          onClick={() => {
                            if (revisionText.trim()) {
                              requestScopeRevision(opCo.id, revisionText.trim());
                              setRevisionOpCoId(null);
                              setRevisionText("");
                            }
                          }}
                          className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-medium text-white hover:bg-rose-700"
                        >
                          Send Revision Request
                        </button>
                        <button
                          onClick={() => setRevisionOpCoId(null)}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => setRevisionOpCoId(opCo.id)}
                          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Request Revision
                        </button>
                        <button
                          onClick={() => approveScopeAsContractor(opCo.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-800"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Approve My Scope & Estimate
                        </button>
                      </>
                    )}
                  </>
                )}

                {role.type === "client" && opCo.agreementStatus === "sent_to_client" && (
                  <button
                    onClick={() => onNavigateTab("agreements")}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    Proceed to Sign {opCo.companyName} Agreement
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
