"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, Plus, ShieldCheck, X } from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import type { JobWorkspace, SettlementRail } from "@/lib/cobid/types";

interface NewJobModalProps {
  open: boolean;
  onClose: () => void;
}

export function NewJobModal({ open, onClose }: NewJobModalProps) {
  const { createJobWorkspace, directory } = useWorkspace();

  const [propertyAddress, setPropertyAddress] = useState("");
  const [suburbState, setSuburbState] = useState("");
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientRole, setClientRole] = useState("Property Owner / Representative");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [leadSourceType, setLeadSourceType] = useState<JobWorkspace["leadSourceType"]>(
    "NDIS / Support Coordinator"
  );
  const [settlementRail, setSettlementRail] = useState<SettlementRail>("direct_to_opco");
  const [siteAccessNotes, setSiteAccessNotes] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && selectedKeys.length === 0 && directory.length > 0) {
      setSelectedKeys(directory.slice(0, 2).map((d) => d.key));
    }
  }, [open, directory, selectedKeys.length]);

  if (!open) return null;

  const toggleOpCo = (key: string) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyAddress.trim() || !clientName.trim() || selectedKeys.length === 0) return;
    setSubmitting(true);
    try {
      await createJobWorkspace({
        title: title.trim(),
        propertyAddress: propertyAddress.trim(),
        suburbState: suburbState.trim(),
        clientName: clientName.trim(),
        clientRole: clientRole.trim(),
        clientEmail: clientEmail.trim(),
        clientPhone: clientPhone.trim(),
        leadSource: leadSource.trim(),
        leadSourceType,
        settlementRail,
        siteAccessNotes: siteAccessNotes.trim(),
        selectedOpCoKeys: selectedKeys,
      });
      setPropertyAddress("");
      setSuburbState("");
      setTitle("");
      setClientName("");
      setClientEmail("");
      setClientPhone("");
      setLeadSource("");
      setSiteAccessNotes("");
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Scoping Desk · Lead Intake
            </div>
            <h2 className="text-base font-semibold text-slate-900">
              Create New Co-Bid Job Workspace
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6 text-xs">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block font-medium text-slate-700">Job Title</label>
              <input
                type="text"
                placeholder="e.g. Hoarding Clearance & Biohazard Decontamination"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">Street Address *</label>
              <input
                type="text"
                required
                placeholder="e.g. 14 Banksia Grove"
                value={propertyAddress}
                onChange={(e) => setPropertyAddress(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">Suburb, State & Postcode</label>
              <input
                type="text"
                placeholder="e.g. Brisbane QLD 4000"
                value={suburbState}
                onChange={(e) => setSuburbState(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
            <div>
              <label className="block font-medium text-slate-700">Client Name *</label>
              <input
                type="text"
                required
                placeholder="Full name"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">Client Role</label>
              <input
                type="text"
                value={clientRole}
                onChange={(e) => setClientRole(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">Client Email</label>
              <input
                type="email"
                placeholder="client@example.com.au"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">Client Phone</label>
              <input
                type="tel"
                placeholder="0400 000 000"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">Lead Origin Channel</label>
              <select
                value={leadSourceType}
                onChange={(e) =>
                  setLeadSourceType(e.target.value as JobWorkspace["leadSourceType"])
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              >
                <option value="NDIS / Support Coordinator">NDIS / Support Coordinator</option>
                <option value="Insurer">Insurer</option>
                <option value="Strata / Property Manager">Strata / Property Manager</option>
                <option value="Contractor Referral">Contractor Referral</option>
                <option value="Direct Client">Direct Client</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700">Referring Party / Source</label>
              <input
                type="text"
                placeholder="Organisation or referrer name"
                value={leadSource}
                onChange={(e) => setLeadSource(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium text-slate-700">Site Access & Hazards Notes</label>
              <input
                type="text"
                placeholder="Key safe, parking, PPE requirements, site hazards..."
                value={siteAccessNotes}
                onChange={(e) => setSiteAccessNotes(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-900">
                  Select Independent Co-Bid OpCos (Auto-Sequenced)
                </div>
                <p className="text-[11px] text-slate-500">
                  Click in execution order. Each selected OpCo gets its own independent Scope,
                  Agreement, Deposit, and Handover Gate.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
                {selectedKeys.length} selected
              </span>
            </div>

            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {directory.map((tpl) => {
                const orderIdx = selectedKeys.indexOf(tpl.key);
                const isSelected = orderIdx !== -1;
                return (
                  <button
                    type="button"
                    key={tpl.id}
                    onClick={() => toggleOpCo(tpl.key)}
                    className={`flex items-start justify-between gap-3 rounded-xl border p-3 text-left transition ${
                      isSelected
                        ? "border-slate-900 bg-slate-900/5"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${
                          isSelected
                            ? "bg-slate-900 text-white"
                            : "border border-slate-200 bg-slate-50 text-slate-700"
                        }`}
                      >
                        {isSelected ? `S${orderIdx + 1}` : tpl.monogram}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{tpl.tradeCategory}</div>
                        <div className="text-[11px] text-slate-600">{tpl.companyName}</div>
                        <div className="text-[10px] text-slate-400">ABN {tpl.abn}</div>
                      </div>
                    </div>
                    <div
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        isSelected
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-300 bg-white"
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedKeys.length > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                <span className="font-semibold text-slate-800">Handover Sequence:</span>
                {selectedKeys.map((k, i) => {
                  const tpl = directory.find((t) => t.key === k);
                  return (
                    <span key={k} className="inline-flex items-center gap-1.5">
                      <span className="rounded bg-white px-2 py-0.5 font-medium text-slate-800 shadow-2xs">
                        Stage {i + 1}: {tpl?.monogram}
                      </span>
                      {i < selectedKeys.length - 1 && (
                        <ArrowRight className="h-3 w-3 text-slate-400" />
                      )}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-slate-700" />
              <span className="font-semibold text-slate-800">Default Settlement Rail</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSettlementRail("direct_to_opco")}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  settlementRail === "direct_to_opco"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-600"
                }`}
              >
                Direct to OpCo
              </button>
              <button
                type="button"
                onClick={() => setSettlementRail("trust_clearing")}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  settlementRail === "trust_clearing"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-600"
                }`}
              >
                Trust Clearing → OpCos
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={selectedKeys.length === 0 || submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-5 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
              {submitting ? "Creating…" : "Create Co-Bid Workspace"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
