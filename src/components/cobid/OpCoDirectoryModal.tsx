"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCheck2,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import {
  QUOTE_TYPE_META,
  type DirectoryOpCo,
  type OnboardingStatus,
  type QuoteType,
} from "@/lib/cobid/types";

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

const FILTER_PILLS: { id: "all" | OnboardingStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending_review", label: "Pending Review" },
  { id: "approved", label: "Approved" },
  { id: "in_progress", label: "In Progress" },
  { id: "invited", label: "Invited" },
  { id: "suspended", label: "Suspended" },
];

const QUOTE_TYPES: QuoteType[] = ["bcq", "sacq", "ccq", "mtq", "custom"];

function onboardingBadge(status: OnboardingStatus) {
  const map: Record<OnboardingStatus, { label: string; cls: string }> = {
    invited: { label: "Invited", cls: "bg-slate-100 text-slate-700 border-slate-200" },
    in_progress: { label: "In Progress", cls: "bg-blue-50 text-blue-700 border-blue-200" },
    pending_review: { label: "Pending Review", cls: "bg-amber-50 text-amber-800 border-amber-200" },
    approved: { label: "Approved", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
    suspended: { label: "Suspended", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  };
  const c = map[status] ?? map.approved;
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${c.cls}`}>
      {c.label}
    </span>
  );
}

export function OpCoDirectoryModal({ open, onClose }: OpCoDirectoryModalProps) {
  const { directory, refreshDirectory, saveDirectoryOpCo, archiveDirectoryOpCo } = useWorkspace();

  const [filter, setFilter] = useState<"all" | OnboardingStatus>("all");
  const [editing, setEditing] = useState<typeof BLANK_FORM | null>(null);
  const [inviting, setInviting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Invite form state
  const [invCompany, setInvCompany] = useState("");
  const [invTrade, setInvTrade] = useState("");
  const [invContact, setInvContact] = useState("");
  const [invEmail, setInvEmail] = useState("");
  const [invPhone, setInvPhone] = useState("");
  const [invQuoteTypes, setInvQuoteTypes] = useState<QuoteType[]>(["bcq", "sacq"]);
  const [inviteResult, setInviteResult] = useState<{
    url: string;
    emailSent: boolean;
    emailError?: string;
    companyName: string;
  } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Review state
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [busyOpCoId, setBusyOpCoId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  if (!open) return null;

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedUrl(text);
    setTimeout(() => setCopiedUrl((c) => (c === text ? null : c)), 2000);
  };

  const startEdit = (opCo?: DirectoryOpCo) => {
    setInviting(false);
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

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invCompany.trim() || !invTrade.trim() || !invEmail.trim()) return;
    setSaving(true);
    setInviteResult(null);
    try {
      const res = await fetch("/api/cobid/opcos/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: invCompany.trim(),
          tradeCategory: invTrade.trim(),
          contactName: invContact.trim(),
          contactEmail: invEmail.trim(),
          phone: invPhone.trim(),
          allowedQuoteTypes: invQuoteTypes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to send invite");
      setInviteResult({
        url: data.onboardingUrl,
        emailSent: Boolean(data.emailSent),
        emailError: data.emailError,
        companyName: invCompany.trim(),
      });
      setInvCompany("");
      setInvTrade("");
      setInvContact("");
      setInvEmail("");
      setInvPhone("");
      await refreshDirectory();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setSaving(false);
    }
  };

  const callReview = async (
    opcoId: string,
    payload: Record<string, unknown>,
    successLabel: string
  ) => {
    setBusyOpCoId(opcoId);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/cobid/opcos/${encodeURIComponent(opcoId)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Review action failed");
      await refreshDirectory();
      if (data.onboardingUrl) {
        copyText(data.onboardingUrl);
        setStatusMsg(
          `${successLabel} — Link copied! ${data.emailSent ? "Email sent." : data.emailError ? `(${data.emailError})` : ""}`
        );
      } else {
        setStatusMsg(successLabel);
      }
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyOpCoId(null);
    }
  };

  const filtered =
    filter === "all" ? directory : directory.filter((o) => o.onboardingStatus === filter);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Independent Operator Onboarding &amp; Directory
              </h2>
              <p className="text-[11px] text-slate-500">
                Invite operators, verify insurances &amp; compliance, connect per-OpCo Xero, and
                approve profiles before job invitations.
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
          {statusMsg && (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 font-medium text-slate-800">
              <span>{statusMsg}</span>
              <button onClick={() => setStatusMsg(null)} className="text-slate-400 hover:text-slate-700">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {inviting ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Invite New Independent Operator to Onboard
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setInviting(false);
                    setInviteResult(null);
                  }}
                  className="text-slate-500 hover:text-slate-800"
                >
                  Back to Directory
                </button>
              </div>

              {inviteResult && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                  <div className="font-semibold">
                    Onboarding Portal Ready for {inviteResult.companyName}
                  </div>
                  <p className="mt-1 text-[11px] text-emerald-800">
                    {inviteResult.emailSent
                      ? "Onboarding email sent via Resend. You can also copy the link directly:"
                      : `Link generated (${inviteResult.emailError || "copy & share directly"}):`}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      readOnly
                      value={inviteResult.url}
                      className="flex-1 bg-white font-mono text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => copyText(inviteResult.url)}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white hover:bg-slate-800"
                    >
                      {copiedUrl === inviteResult.url ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedUrl === inviteResult.url ? "Copied" : "Copy Link"}
                    </button>
                  </div>
                </div>
              )}

              <form onSubmit={handleInviteSubmit} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block font-medium text-slate-700">Company / Trading Name *</label>
                    <input
                      required
                      value={invCompany}
                      onChange={(e) => setInvCompany(e.target.value)}
                      placeholder="e.g. Precision Biohazard Solutions Pty Ltd"
                      className="mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700">Trade Category *</label>
                    <input
                      required
                      value={invTrade}
                      onChange={(e) => setInvTrade(e.target.value)}
                      placeholder="e.g. Biohazard Cleaning / Surface Decontamination"
                      className="mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700">Primary Contact Name</label>
                    <input
                      value={invContact}
                      onChange={(e) => setInvContact(e.target.value)}
                      placeholder="Estimator / Director"
                      className="mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700">Contact Email *</label>
                    <input
                      type="email"
                      required
                      value={invEmail}
                      onChange={(e) => setInvEmail(e.target.value)}
                      placeholder="quotes@operator.com.au"
                      className="mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700">Phone</label>
                    <input
                      value={invPhone}
                      onChange={(e) => setInvPhone(e.target.value)}
                      placeholder="0400 000 000"
                      className="mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700">Default Quote Types</label>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {QUOTE_TYPES.map((qt) => {
                        const on = invQuoteTypes.includes(qt);
                        return (
                          <button
                            key={qt}
                            type="button"
                            onClick={() =>
                              setInvQuoteTypes((prev) =>
                                prev.includes(qt)
                                  ? prev.length > 1
                                    ? prev.filter((x) => x !== qt)
                                    : prev
                                  : [...prev, qt]
                              )
                            }
                            className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                              on
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-white text-slate-600"
                            }`}
                          >
                            {QUOTE_TYPE_META[qt].code}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                  <button
                    type="button"
                    onClick={() => setInviting(false)}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-5 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {saving ? "Creating Invite…" : "Email & Generate Onboarding Link"}
                  </button>
                </div>
              </form>
            </div>
          ) : editing ? (
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-medium text-slate-700">Company / OpCo Name *</label>
                  <input
                    required
                    value={editing.companyName}
                    onChange={(e) => setEditing({ ...editing, companyName: e.target.value })}
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Trade Category *</label>
                  <input
                    required
                    value={editing.tradeCategory}
                    onChange={(e) => setEditing({ ...editing, tradeCategory: e.target.value })}
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">ABN</label>
                  <input
                    value={editing.abn}
                    onChange={(e) => setEditing({ ...editing, abn: e.target.value })}
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Licence / Certification</label>
                  <input
                    value={editing.licenceNumber}
                    onChange={(e) => setEditing({ ...editing, licenceNumber: e.target.value })}
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Contact Name</label>
                  <input
                    value={editing.contactName}
                    onChange={(e) => setEditing({ ...editing, contactName: e.target.value })}
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Contact Email</label>
                  <input
                    type="email"
                    value={editing.contactEmail}
                    onChange={(e) => setEditing({ ...editing, contactEmail: e.target.value })}
                    className="mt-1 w-full"
                  />
                </div>
              </div>

              <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
                <div>
                  <label className="block font-medium text-slate-700">Bank Name</label>
                  <input
                    value={editing.bankName}
                    onChange={(e) => setEditing({ ...editing, bankName: e.target.value })}
                    className="mt-1 w-full bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">BSB</label>
                  <input
                    value={editing.bsb}
                    onChange={(e) => setEditing({ ...editing, bsb: e.target.value })}
                    className="mt-1 w-full bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Account Number</label>
                  <input
                    value={editing.accountNumber}
                    onChange={(e) => setEditing({ ...editing, accountNumber: e.target.value })}
                    className="mt-1 w-full bg-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700">PayID</label>
                  <input
                    value={editing.payId}
                    onChange={(e) => setEditing({ ...editing, payId: e.target.value })}
                    className="mt-1 w-full bg-white"
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
                    className="mt-1 w-full bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700">Default Scope Summary</label>
                <textarea
                  rows={3}
                  value={editing.defaultScopeSummary}
                  onChange={(e) => setEditing({ ...editing, defaultScopeSummary: e.target.value })}
                  className="mt-1 w-full"
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {FILTER_PILLS.map((pill) => {
                    const count =
                      pill.id === "all"
                        ? directory.length
                        : directory.filter((o) => o.onboardingStatus === pill.id).length;
                    return (
                      <button
                        key={pill.id}
                        type="button"
                        onClick={() => setFilter(pill.id)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                          filter === pill.id
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {pill.label} ({count})
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setInviteResult(null);
                      setInviting(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Invite New Operator
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit()}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Quick Add
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {filtered.map((opCo) => {
                  const isExpanded = expandedId === opCo.id;
                  const busy = busyOpCoId === opCo.id;
                  return (
                    <div
                      key={opCo.id}
                      className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                    >
                      <div className="flex flex-col justify-between gap-3 bg-slate-50/70 p-3.5 sm:flex-row sm:items-center">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800">
                            {opCo.monogram}
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-slate-900">
                                {opCo.companyName}
                              </span>
                              {onboardingBadge(opCo.onboardingStatus)}
                              {opCo.hasExpiredCompliance && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800">
                                  <AlertTriangle className="h-3 w-3" />
                                  Expired Compliance
                                </span>
                              )}
                              {opCo.xero.connected ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-800 ring-1 ring-sky-200">
                                  Xero: {opCo.xero.tenantName || "Connected"}
                                </span>
                              ) : (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                                  Manual EFT
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-600">
                              {opCo.tradeCategory} · Quotes:{" "}
                              {opCo.allowedQuoteTypes
                                .map((q) => QUOTE_TYPE_META[q]?.code || q)
                                .join(", ")}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              ABN {opCo.abn || "Pending"} · {opCo.contactEmail || "No email"} ·{" "}
                              {opCo.complianceDocs.length} compliance doc
                              {opCo.complianceDocs.length === 1 ? "" : "s"}
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : opCo.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                          >
                            <FileCheck2 className="h-3 w-3" />
                            {isExpanded ? "Hide Review" : "Review & Compliance"}
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(opCo)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <Pencil className="h-3 w-3" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => archiveDirectoryOpCo(opCo.id)}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            title="Archive OpCo"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="space-y-4 border-t border-slate-200 p-4">
                          {/* Deed + Xero Row */}
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                                <ShieldCheck className="h-3.5 w-3.5 text-slate-600" />
                                Independent Operator Platform Deed
                              </div>
                              {opCo.deedSignedAt ? (
                                <div className="mt-1 text-[11px] text-emerald-800">
                                  Signed by <strong>{opCo.deedSignedBy}</strong> (
                                  {opCo.deedSignedTitle})
                                  <div className="font-mono text-[10px] text-slate-500">
                                    {opCo.deedAuditHash}
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-1 text-[11px] text-amber-700">
                                  Not yet signed by operator.
                                </div>
                              )}
                            </div>

                            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <div>
                                <div className="font-semibold text-slate-800">
                                  Per-OpCo Xero OAuth
                                </div>
                                <div className="mt-0.5 text-[11px] text-slate-600">
                                  {opCo.xero.connected
                                    ? `Connected to ${opCo.xero.tenantName} (${opCo.xero.invoiceMode})`
                                    : "Not connected — falls back to manual bank/PayID."}
                                </div>
                              </div>
                              <a
                                href={`/api/cobid/xero/connect?opcoId=${encodeURIComponent(opCo.id)}`}
                                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#13B5EA] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#0ea3d4]"
                              >
                                {opCo.xero.connected ? "Reconnect" : "Connect Xero"}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          </div>

                          {/* Compliance Documents */}
                          <div>
                            <div className="mb-2 font-semibold text-slate-800">
                              Compliance &amp; Insurance Vault ({opCo.complianceDocs.length})
                            </div>
                            {opCo.complianceDocs.length === 0 ? (
                              <div className="rounded-lg border border-dashed border-slate-200 p-3 text-[11px] text-slate-500">
                                No compliance certificates uploaded yet.
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {opCo.complianceDocs.map((doc) => (
                                  <div
                                    key={doc.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5"
                                  >
                                    <div>
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="font-semibold text-slate-900">
                                          {doc.title}
                                        </span>
                                        <span
                                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                                            doc.isExpired
                                              ? "bg-rose-100 text-rose-800"
                                              : doc.status === "verified"
                                                ? "bg-emerald-100 text-emerald-800"
                                                : doc.status === "rejected"
                                                  ? "bg-rose-100 text-rose-800"
                                                  : "bg-amber-100 text-amber-800"
                                          }`}
                                        >
                                          {doc.isExpired ? "Expired" : doc.status}
                                        </span>
                                      </div>
                                      <div className="text-[11px] text-slate-500">
                                        {doc.issuerOrInsurer ? `${doc.issuerOrInsurer} · ` : ""}
                                        {doc.documentNumber ? `#${doc.documentNumber} · ` : ""}
                                        {doc.coverageAmount ? `${doc.coverageAmount} · ` : ""}
                                        Expires: {doc.expiresAt || "Not set"}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <a
                                        href={`/api/cobid/files?path=${encodeURIComponent(doc.filePath)}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                                      >
                                        View
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                      {doc.status !== "verified" && (
                                        <button
                                          type="button"
                                          disabled={busy}
                                          onClick={() =>
                                            callReview(
                                              opCo.id,
                                              { action: "verify_doc", docId: doc.id },
                                              `Verified ${doc.title}`
                                            )
                                          }
                                          className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                                        >
                                          <CheckCircle2 className="h-3 w-3" />
                                          Verify
                                        </button>
                                      )}
                                      {doc.status !== "rejected" && (
                                        <button
                                          type="button"
                                          disabled={busy}
                                          onClick={() =>
                                            callReview(
                                              opCo.id,
                                              {
                                                action: "reject_doc",
                                                docId: doc.id,
                                                reason:
                                                  reviewNotes[opCo.id] ||
                                                  "Please upload an updated certificate.",
                                              },
                                              `Rejected ${doc.title}`
                                            )
                                          }
                                          className="inline-flex items-center gap-1 rounded bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                                        >
                                          <XCircle className="h-3 w-3" />
                                          Reject
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Coordinator Review Actions */}
                          <div className="flex flex-col gap-2.5 border-t border-slate-100 pt-3">
                            <input
                              value={reviewNotes[opCo.id] ?? opCo.reviewNotes ?? ""}
                              onChange={(e) =>
                                setReviewNotes((prev) => ({ ...prev, [opCo.id]: e.target.value }))
                              }
                              placeholder="Optional coordinator review note or change request reason..."
                              className="w-full"
                            />
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  callReview(
                                    opCo.id,
                                    { action: "resend_onboarding_link" },
                                    `Fresh onboarding link issued for ${opCo.companyName}`
                                  )
                                }
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                              >
                                <Link2 className="h-3.5 w-3.5" />
                                Issue / Email Onboarding Link
                              </button>

                              <div className="flex flex-wrap items-center gap-1.5">
                                {opCo.onboardingStatus !== "in_progress" && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      callReview(
                                        opCo.id,
                                        {
                                          action: "request_changes",
                                          notes:
                                            reviewNotes[opCo.id] ||
                                            "Please review and update your onboarding details.",
                                        },
                                        `Requested changes from ${opCo.companyName}`
                                      )
                                    }
                                    className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100"
                                  >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    Request Changes
                                  </button>
                                )}
                                {opCo.onboardingStatus !== "suspended" && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      callReview(
                                        opCo.id,
                                        {
                                          action: "suspend",
                                          notes: reviewNotes[opCo.id] || "Suspended by coordinator",
                                        },
                                        `Suspended ${opCo.companyName}`
                                      )
                                    }
                                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 font-semibold text-rose-700 hover:bg-rose-100"
                                  >
                                    <ShieldAlert className="h-3.5 w-3.5" />
                                    Suspend
                                  </button>
                                )}
                                {opCo.onboardingStatus !== "approved" && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      callReview(
                                        opCo.id,
                                        { action: "approve", notes: reviewNotes[opCo.id] || "" },
                                        `Approved ${opCo.companyName} for Co-Bid job invitations`
                                      )
                                    }
                                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3.5 py-1.5 font-semibold text-white hover:bg-emerald-800"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Approve Operator
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
