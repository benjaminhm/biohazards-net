"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  Check,
  Link2,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import {
  QUOTE_TYPE_META,
  type JobWorkspace,
  type QuoteType,
  type SettlementRail,
} from "@/lib/cobid/types";

interface NewJobModalProps {
  open: boolean;
  onClose: () => void;
}

interface LinkedJobOption {
  id: string;
  job_code?: string;
  site_address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  client_name?: string;
  client_email?: string;
  client_phone?: string;
  job_type?: string;
}

interface LinkedPhoto {
  id: string;
  url: string;
  caption?: string;
  category?: string;
}

const QUOTE_TYPES: QuoteType[] = ["bcq", "sacq", "ccq", "mtq", "custom"];

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
  const [quoteTypesByOpCo, setQuoteTypesByOpCo] = useState<Record<string, QuoteType>>({});
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Optional biohazards-net linked job + shared photos
  const [linkedJobs, setLinkedJobs] = useState<LinkedJobOption[]>([]);
  const [linkedJobId, setLinkedJobId] = useState("");
  const [linkedPhotos, setLinkedPhotos] = useState<LinkedPhoto[]>([]);
  const [sharedPhotoIds, setSharedPhotoIds] = useState<string[]>([]);

  const eligibleOpCos = directory.filter(
    (d) => d.onboardingStatus === "approved" && !d.hasExpiredCompliance
  );

  useEffect(() => {
    if (!open) return;
    setErrorMsg(null);
    if (selectedKeys.length === 0 && eligibleOpCos.length > 0) {
      const initial = eligibleOpCos.slice(0, 2);
      setSelectedKeys(initial.map((d) => d.key));
      const qtMap: Record<string, QuoteType> = {};
      for (const op of initial) {
        qtMap[op.key] = op.allowedQuoteTypes[0] ?? "custom";
      }
      setQuoteTypesByOpCo((prev) => ({ ...qtMap, ...prev }));
    }

    fetch("/api/cobid/linked-jobs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { jobs: [] }))
      .then((d) => setLinkedJobs(Array.isArray(d.jobs) ? d.jobs : []))
      .catch(() => setLinkedJobs([]));
  }, [open, directory.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectLinkedJob = async (jobId: string) => {
    setLinkedJobId(jobId);
    setSharedPhotoIds([]);
    setLinkedPhotos([]);
    if (!jobId) return;

    try {
      const res = await fetch(`/api/cobid/linked-jobs?jobId=${encodeURIComponent(jobId)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      const j = data.job as LinkedJobOption | null;
      if (j) {
        if (!propertyAddress && j.site_address) setPropertyAddress(j.site_address);
        if (!suburbState) {
          const sub = [j.suburb, j.state, j.postcode].filter(Boolean).join(" ");
          if (sub) setSuburbState(sub);
        }
        if (!clientName && j.client_name) setClientName(j.client_name);
        if (!clientEmail && j.client_email) setClientEmail(j.client_email);
        if (!clientPhone && j.client_phone) setClientPhone(j.client_phone);
      }
      const photos = Array.isArray(data.photos) ? (data.photos as LinkedPhoto[]) : [];
      setLinkedPhotos(photos);
      setSharedPhotoIds(photos.slice(0, 6).map((p) => p.id));
    } catch {
      // Ignore
    }
  };

  if (!open) return null;

  const toggleOpCo = (key: string, defaultQt: QuoteType) => {
    setSelectedKeys((prev) => {
      if (prev.includes(key)) {
        return prev.filter((k) => k !== key);
      }
      setQuoteTypesByOpCo((m) => (m[key] ? m : { ...m, [key]: defaultQt }));
      return [...prev, key];
    });
  };

  const togglePhoto = (id: string) => {
    setSharedPhotoIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyAddress.trim() || !clientName.trim() || selectedKeys.length === 0) return;
    setSubmitting(true);
    setErrorMsg(null);
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
        quoteTypesByOpCo,
        linkedJobId: linkedJobId || undefined,
        sharedPhotoIds,
      });
      setPropertyAddress("");
      setSuburbState("");
      setTitle("");
      setClientName("");
      setClientEmail("");
      setClientPhone("");
      setLeadSource("");
      setSiteAccessNotes("");
      setLinkedJobId("");
      setLinkedPhotos([]);
      setSharedPhotoIds([]);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to create workspace");
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
          {errorMsg && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Optional Link Existing biohazards-net Job */}
          {linkedJobs.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                <Link2 className="h-3.5 w-3.5 text-slate-600" />
                Link Existing Job &amp; Share Site Photos (Optional)
              </div>
              <select
                value={linkedJobId}
                onChange={(e) => handleSelectLinkedJob(e.target.value)}
                className="mt-2 w-full bg-white"
              >
                <option value="">Standalone Co-Bid Workspace (no linked job)</option>
                {linkedJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.job_code || j.id.slice(0, 8)} — {j.site_address || "Untitled"} ({j.client_name || "No client"})
                  </option>
                ))}
              </select>

              {linkedPhotos.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-600">
                    <span className="inline-flex items-center gap-1 font-medium">
                      <Camera className="h-3 w-3" />
                      Select site photos to share with invited operators ({sharedPhotoIds.length}{" "}
                      selected)
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {linkedPhotos.slice(0, 12).map((p) => {
                      const picked = sharedPhotoIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => togglePhoto(p.id)}
                          className={`relative overflow-hidden rounded-lg border-2 ${
                            picked ? "border-slate-900" : "border-transparent opacity-65"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.url} alt={p.caption || "Photo"} className="h-14 w-full object-cover" />
                          {picked && (
                            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-white">
                              <Check className="h-2.5 w-2.5" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block font-medium text-slate-700">Job Title</label>
              <input
                type="text"
                placeholder="e.g. Hoarding Clearance & Biohazard Decontamination"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full"
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
                className="mt-1 w-full"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">Suburb, State & Postcode</label>
              <input
                type="text"
                placeholder="e.g. Brisbane QLD 4000"
                value={suburbState}
                onChange={(e) => setSuburbState(e.target.value)}
                className="mt-1 w-full"
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
                className="mt-1 w-full bg-white"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">Client Role</label>
              <input
                type="text"
                value={clientRole}
                onChange={(e) => setClientRole(e.target.value)}
                className="mt-1 w-full bg-white"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">Client Email</label>
              <input
                type="email"
                placeholder="client@example.com.au"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                className="mt-1 w-full bg-white"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">Client Phone</label>
              <input
                type="tel"
                placeholder="0400 000 000"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                className="mt-1 w-full bg-white"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">Lead Origin Channel</label>
              <select
                value={leadSourceType}
                onChange={(e) =>
                  setLeadSourceType(e.target.value as JobWorkspace["leadSourceType"])
                }
                className="mt-1 w-full bg-white"
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
                className="mt-1 w-full bg-white"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium text-slate-700">Site Access & Hazards Notes</label>
              <input
                type="text"
                placeholder="Key safe, parking, PPE requirements, site hazards..."
                value={siteAccessNotes}
                onChange={(e) => setSiteAccessNotes(e.target.value)}
                className="mt-1 w-full bg-white"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-900">
                  Select Approved Independent Operators &amp; Quote Builder Type
                </div>
                <p className="text-[11px] text-slate-500">
                  Only approved operators with current compliance can be invited. Choose the
                  structured quote template (BCQ / SACQ / CCQ / MTQ / Trade) for each stage.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
                {selectedKeys.length} selected
              </span>
            </div>

            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {directory.map((tpl) => {
                const eligible =
                  tpl.onboardingStatus === "approved" && !tpl.hasExpiredCompliance;
                const orderIdx = selectedKeys.indexOf(tpl.key);
                const isSelected = orderIdx !== -1;
                const chosenQt =
                  quoteTypesByOpCo[tpl.key] ?? tpl.allowedQuoteTypes[0] ?? "custom";

                return (
                  <div
                    key={tpl.id}
                    className={`rounded-xl border p-3 transition ${
                      !eligible
                        ? "border-slate-200 bg-slate-100/70 opacity-60"
                        : isSelected
                          ? "border-slate-900 bg-slate-900/5"
                          : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <button
                      type="button"
                      disabled={!eligible}
                      onClick={() => toggleOpCo(tpl.key, chosenQt)}
                      className="flex w-full items-start justify-between gap-3 text-left disabled:cursor-not-allowed"
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
                          <div className="font-semibold text-slate-900">{tpl.companyName}</div>
                          <div className="text-[11px] text-slate-600">{tpl.tradeCategory}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                            <span className="text-slate-400">ABN {tpl.abn || "Pending"}</span>
                            {!eligible && (
                              <span className="rounded bg-rose-100 px-1.5 py-0.5 font-semibold text-rose-800">
                                {tpl.hasExpiredCompliance
                                  ? "Compliance Expired"
                                  : `Status: ${tpl.onboardingStatus.replace(/_/g, " ")}`}
                              </span>
                            )}
                            {eligible && tpl.xero.connected && (
                              <span className="rounded bg-sky-100 px-1.5 py-0.5 font-semibold text-sky-800">
                                Xero Ready
                              </span>
                            )}
                          </div>
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

                    {isSelected && (
                      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-200/80 pt-2">
                        <span className="text-[10px] font-semibold uppercase text-slate-500">
                          Quote Type:
                        </span>
                        <select
                          value={chosenQt}
                          onChange={(e) =>
                            setQuoteTypesByOpCo((prev) => ({
                              ...prev,
                              [tpl.key]: e.target.value as QuoteType,
                            }))
                          }
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium"
                        >
                          {QUOTE_TYPES.map((qt) => (
                            <option key={qt} value={qt}>
                              {QUOTE_TYPE_META[qt].code} — {QUOTE_TYPE_META[qt].label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {selectedKeys.length > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                <span className="font-semibold text-slate-800">Handover Sequence:</span>
                {selectedKeys.map((k, i) => {
                  const tpl = directory.find((t) => t.key === k);
                  const qt = quoteTypesByOpCo[k] ?? tpl?.allowedQuoteTypes[0] ?? "custom";
                  return (
                    <span key={k} className="inline-flex items-center gap-1.5">
                      <span className="rounded bg-white px-2 py-0.5 font-medium text-slate-800 shadow-2xs">
                        Stage {i + 1}: {tpl?.monogram} ({QUOTE_TYPE_META[qt].code})
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
