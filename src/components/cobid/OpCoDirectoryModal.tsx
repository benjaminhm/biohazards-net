"use client";

import { useState } from "react";
import { Building2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import type { DirectoryOpCo } from "@/lib/cobid/types";

interface OpCoDirectoryModalProps {
  open: boolean;
  onClose: () => void;
}

const BLANK_FORM = {
  id: "",
  key: "",
  companyName: "",
  tradeCategory: "",
  abn: "",
  licenceNumber: "",
  monogram: "",
  contactName: "",
  contactEmail: "",
  bankName: "",
  bsb: "",
  accountNumber: "",
  payId: "",
  defaultDepositPercent: 30,
  defaultScopeSummary: "",
};

export function OpCoDirectoryModal({ open, onClose }: OpCoDirectoryModalProps) {
  const { directory, saveDirectoryOpCo, archiveDirectoryOpCo } = useWorkspace();
  const [editing, setEditing] = useState<typeof BLANK_FORM | null>(null);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const startEdit = (opCo?: DirectoryOpCo) => {
    if (!opCo) {
      setEditing({ ...BLANK_FORM });
      return;
    }
    setEditing({
      id: opCo.id,
      key: opCo.key,
      companyName: opCo.companyName,
      tradeCategory: opCo.tradeCategory,
      abn: opCo.abn,
      licenceNumber: opCo.licenceNumber,
      monogram: opCo.monogram,
      contactName: opCo.contactName,
      contactEmail: opCo.contactEmail,
      bankName: opCo.bankName,
      bsb: opCo.bsb,
      accountNumber: opCo.accountNumber,
      payId: opCo.payId,
      defaultDepositPercent: opCo.defaultDepositPercent,
      defaultScopeSummary: opCo.defaultScopeSummary,
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !editing.companyName.trim() || !editing.tradeCategory.trim()) return;
    setSaving(true);
    try {
      const existing = editing.id ? directory.find((d) => d.id === editing.id) : undefined;
      await saveDirectoryOpCo({
        ...(existing ?? {}),
        id: editing.id || undefined,
        key: editing.key || undefined,
        companyName: editing.companyName,
        tradeCategory: editing.tradeCategory,
        abn: editing.abn,
        licenceNumber: editing.licenceNumber,
        monogram: editing.monogram,
        contactName: editing.contactName,
        contactEmail: editing.contactEmail,
        bankName: editing.bankName,
        bsb: editing.bsb,
        accountNumber: editing.accountNumber,
        payId: editing.payId,
        defaultDepositPercent: Number(editing.defaultDepositPercent) || 30,
        defaultScopeSummary: editing.defaultScopeSummary,
      });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                OpCo / Partner Contractor Directory
              </h2>
              <p className="text-[11px] text-slate-500">
                Manage real Operating Companies, ABNs, licences & direct-to-OpCo settlement accounts.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 text-xs">
          {editing ? (
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-medium text-slate-700">Company / OpCo Name *</label>
                  <input
                    required
                    value={editing.companyName}
                    onChange={(e) => setEditing({ ...editing, companyName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Trade Category *</label>
                  <input
                    required
                    value={editing.tradeCategory}
                    onChange={(e) => setEditing({ ...editing, tradeCategory: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">ABN</label>
                  <input
                    value={editing.abn}
                    onChange={(e) => setEditing({ ...editing, abn: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Licence / Certification</label>
                  <input
                    value={editing.licenceNumber}
                    onChange={(e) => setEditing({ ...editing, licenceNumber: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Contact Name</label>
                  <input
                    value={editing.contactName}
                    onChange={(e) => setEditing({ ...editing, contactName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Contact Email</label>
                  <input
                    type="email"
                    value={editing.contactEmail}
                    onChange={(e) => setEditing({ ...editing, contactEmail: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
                <div>
                  <label className="block font-medium text-slate-700">Bank Name</label>
                  <input
                    value={editing.bankName}
                    onChange={(e) => setEditing({ ...editing, bankName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">BSB</label>
                  <input
                    value={editing.bsb}
                    onChange={(e) => setEditing({ ...editing, bsb: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Account Number</label>
                  <input
                    value={editing.accountNumber}
                    onChange={(e) => setEditing({ ...editing, accountNumber: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700">PayID</label>
                  <input
                    value={editing.payId}
                    onChange={(e) => setEditing({ ...editing, payId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Default Deposit %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={editing.defaultDepositPercent}
                    onChange={(e) =>
                      setEditing({ ...editing, defaultDepositPercent: Number(e.target.value) })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700">Default Scope Summary</label>
                <textarea
                  rows={3}
                  value={editing.defaultScopeSummary}
                  onChange={(e) => setEditing({ ...editing, defaultScopeSummary: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-5 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save OpCo"}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Active OpCos ({directory.length})
                </span>
                <button
                  onClick={() => startEdit()}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add OpCo
                </button>
              </div>

              <div className="space-y-2.5">
                {directory.map((opCo) => (
                  <div
                    key={opCo.id}
                    className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 sm:flex-row sm:items-center"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800">
                        {opCo.monogram}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{opCo.companyName}</div>
                        <div className="text-[11px] text-slate-600">{opCo.tradeCategory}</div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          ABN {opCo.abn} · {opCo.contactEmail || "No email"} · {opCo.bankName} BSB{" "}
                          {opCo.bsb}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => startEdit(opCo)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        onClick={() => archiveDirectoryOpCo(opCo.id)}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        title="Archive OpCo"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
