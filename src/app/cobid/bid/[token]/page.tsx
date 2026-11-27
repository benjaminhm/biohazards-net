"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardList,
  Lock,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  QUOTE_TYPE_META,
  type LineItem,
  type Milestone,
  type QuoteType,
  type StructuredQuoteData,
} from "@/lib/cobid/types";
import { calcTotals, formatAUD } from "@/lib/cobid/utils";

interface BidPayload {
  site: {
    reference: string;
    title: string;
    propertyAddress: string;
    suburbState: string;
    clientName: string;
    clientRole: string;
    siteAccessNotes: string;
    coordinatorName: string;
    totalStages: number;
  };
  sharedPhotos: Array<{ id: string; url: string; caption?: string; category?: string }>;
  scope: {
    id: string;
    sequenceOrder: number;
    tradeCategory: string;
    quoteType: QuoteType;
    independentJobRef: string;
    structuredQuoteData: StructuredQuoteData;
    companyName: string;
    legalEntityName: string;
    gstRegistered: boolean;
    abn: string;
    licenceNumber: string;
    monogram: string;
    contactName: string;
    contactEmail: string;
    depositPercent: number;
    scopeSummary: string;
    scopeDeliverables: string[];
    exclusions: string[];
    scopeStatus: string;
    contractorApprovedAt: string | null;
    agreementRef: string;
    agreementStatus: string;
    lineItems: LineItem[];
    milestones: Milestone[];
  };
}

const QUOTE_PRESET_STANDARDS: Record<QuoteType, string[]> = {
  bcq: [
    "IICRC S540 Trauma & Crime Scene",
    "Work Health & Safety Regulation (Biological Hazards)",
    "EPA Clinical & Bio-Waste Manifesting",
    "ATP Bioluminescence Hygiene Verification (<30 RLU)",
  ],
  sacq: [
    "IICRC S500 / S520 Surface Decontamination",
    "Hospital-Grade TGA-Listed Antimicrobial Treatment",
    "HEPA Vacuum & Air Scrubbing Protocol",
    "Post-Remediation Verification & Clearance",
  ],
  ccq: [
    "Compassionate Salvage Triage & Chain-of-Custody",
    "Licensed EPA Transfer Station Disposal",
    "Weighbridge Docket Verification",
    "Broom-Swept Structural Handover",
  ],
  mtq: [
    "NIOSH 9111 Methamphetamine Surface Sampling",
    "enHealth Clandestine Drug Lab Guidelines",
    "NATA-Accredited Laboratory Chain of Custody",
  ],
  custom: [
    "Australian Standards & Licensed Trade Compliance",
    "SWMS & Site Induction Compliance",
    "Certificate of Compliance on Completion",
  ],
};

export default function OpCoBidBuilderPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token || "";

  const [payload, setPayload] = useState<BidPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState(false);
  const [banner, setBanner] = useState<{ tone: "emerald" | "rose"; text: string } | null>(null);

  // Editable state
  const [independentJobRef, setIndependentJobRef] = useState("");
  const [scopeSummary, setScopeSummary] = useState("");
  const [depositPercent, setDepositPercent] = useState(30);
  const [deliverablesText, setDeliverablesText] = useState("");
  const [exclusionsText, setExclusionsText] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);

  // Structured BCQ/SACQ/CCQ/MTQ fields
  const [roomsText, setRoomsText] = useState("");
  const [hazardClassification, setHazardClassification] = useState("");
  const [standardsApplied, setStandardsApplied] = useState<string[]>([]);
  const [ppeAndContainment, setPpeAndContainment] = useState("");
  const [wasteDisposalNotes, setWasteDisposalNotes] = useState("");
  const [siteConditions, setSiteConditions] = useState("");
  const [estimatedDuration, setEstimatedDuration] = useState("");
  const [specialNotes, setSpecialNotes] = useState("");

  const hydrate = useCallback((data: BidPayload) => {
    setPayload(data);
    const s = data.scope;
    setIndependentJobRef(s.independentJobRef || s.agreementRef);
    setScopeSummary(s.scopeSummary || "");
    setDepositPercent(s.depositPercent ?? 30);
    setDeliverablesText((s.scopeDeliverables ?? []).join("\n"));
    setExclusionsText((s.exclusions ?? []).join("\n"));
    setLineItems(s.lineItems ?? []);
    setMilestones(s.milestones ?? []);

    const sd = s.structuredQuoteData ?? {};
    setRoomsText((sd.roomsOrZones ?? []).join(", "));
    setHazardClassification(sd.hazardClassification ?? "");
    setStandardsApplied(sd.standardsApplied ?? []);
    setPpeAndContainment(sd.ppeAndContainment ?? "");
    setWasteDisposalNotes(sd.wasteDisposalNotes ?? "");
    setSiteConditions(sd.siteConditions ?? "");
    setEstimatedDuration(sd.estimatedDuration ?? "");
    setSpecialNotes(sd.specialNotes ?? "");
  }, []);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`/api/cobid/bid/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Invite not found");
        hydrate(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load quote builder"))
      .finally(() => setLoading(false));
  }, [token, hydrate]);

  const toggleStandard = (label: string) => {
    setStandardsApplied((prev) =>
      prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]
    );
  };

  const addLineItem = () => {
    const prefix = payload ? QUOTE_TYPE_META[payload.scope.quoteType].code : "LI";
    setLineItems((prev) => [
      ...prev,
      {
        id: `tmp-${Date.now()}-${prev.length}`,
        code: `${prefix}-${String(prev.length + 1).padStart(2, "0")}`,
        description: "",
        unit: "Allow",
        qty: 1,
        unitPrice: 0,
        category: "Remediation",
      },
    ]);
  };

  const updateLineItem = (idx: number, patch: Partial<LineItem>) => {
    setLineItems((prev) => prev.map((li, i) => (i === idx ? { ...li, ...patch } : li)));
  };

  const removeLineItem = (idx: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const addMilestone = () => {
    setMilestones((prev) => [
      ...prev,
      {
        id: `ms-${Date.now()}-${prev.length}`,
        title: "",
        description: "",
        targetDay: `Day ${prev.length + 1}`,
        status: "pending",
        isHandoverGate: prev.length > 0,
      },
    ]);
  };

  const saveDraft = async (): Promise<boolean> => {
    setSaving(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/cobid/bid/${encodeURIComponent(token)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          independentJobRef,
          scopeSummary,
          depositPercent: Number(depositPercent) || 30,
          scopeDeliverables: deliverablesText
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
          exclusions: exclusionsText
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
          structuredQuoteData: {
            roomsOrZones: roomsText
              .split(",")
              .map((r) => r.trim())
              .filter(Boolean),
            hazardClassification,
            standardsApplied,
            ppeAndContainment,
            wasteDisposalNotes,
            siteConditions,
            estimatedDuration,
            specialNotes,
          },
          lineItems,
          milestones,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ tone: "rose", text: data?.error || "Failed to save draft" });
        return false;
      }
      hydrate(data);
      setBanner({ tone: "emerald", text: "Independent quote draft saved." });
      return true;
    } catch {
      setBanner({ tone: "rose", text: "Network error saving draft." });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleApproveAndLock = async () => {
    const saved = await saveDraft();
    if (!saved) return;
    setLocking(true);
    try {
      const res = await fetch(`/api/cobid/bid/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve_quote" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ tone: "rose", text: data?.error || "Could not lock quote" });
        return;
      }
      hydrate(data);
      setBanner({
        tone: "emerald",
        text: "Quote approved & locked! The Coordinator can now dispatch your standalone company document to the client.",
      });
    } finally {
      setLocking(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-xs text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading Independent Quote Builder…
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" />
          <h1 className="mt-3 text-base font-semibold text-slate-900">Quote Builder Unavailable</h1>
          <p className="mt-1.5 text-xs text-slate-600">{error || "Invite link is invalid."}</p>
        </div>
      </div>
    );
  }

  const { site, scope, sharedPhotos } = payload;
  const qtMeta = QUOTE_TYPE_META[scope.quoteType] ?? QUOTE_TYPE_META.custom;
  const standardsList = QUOTE_PRESET_STANDARDS[scope.quoteType] ?? QUOTE_PRESET_STANDARDS.custom;
  const totals = calcTotals(lineItems, depositPercent);
  const gst = scope.gstRegistered ? totals.baseSubtotal * 0.1 : 0;
  const totalIncGst = totals.baseSubtotal + gst;
  const depositAmount = totalIncGst * (depositPercent / 100);
  const isLocked = scope.scopeStatus === "contractor_approved";
  const isSigned = scope.agreementStatus === "signed";

  return (
    <div className="min-h-screen bg-slate-50 pb-20 text-slate-900">
      <header className="border-b border-slate-200 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-xs font-bold text-slate-950">
              {scope.monogram}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <span>
                  Stage {scope.sequenceOrder} of {site.totalStages}
                </span>
                <span>·</span>
                <span className="rounded bg-white/15 px-1.5 py-0.5 text-white">
                  {qtMeta.code} · {qtMeta.label}
                </span>
              </div>
              <h1 className="text-base font-semibold">
                {scope.companyName}{" "}
                <span className="font-normal text-slate-400">(ABN {scope.abn || "TBA"})</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-[11px] font-medium text-slate-200">
              <Lock className="h-3 w-3 text-emerald-400" />
              Ring-Fenced to Your Company
            </span>
            {isLocked && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/40">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Locked &amp; Approved
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 pt-6 sm:px-6 text-xs">
        {banner && (
          <div
            className={`rounded-xl border px-4 py-3 font-medium ${
              banner.tone === "emerald"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {banner.text}
          </div>
        )}

        {/* Site Brief & Shared Photos */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Shared Site Brief · Workspace {site.reference}
              </div>
              <h2 className="mt-1 text-base font-semibold text-slate-900">
                {site.propertyAddress}
                {site.suburbState ? `, ${site.suburbState}` : ""}
              </h2>
              <p className="mt-1 text-slate-600">
                Client: <strong>{site.clientName}</strong> ({site.clientRole}) · Coordinator:{" "}
                {site.coordinatorName}
              </p>
              {site.siteAccessNotes && (
                <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                  <strong>Site Access &amp; Notes:</strong> {site.siteAccessNotes}
                </div>
              )}
            </div>
            <div className="w-full sm:w-56">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Your Independent Job Ref
              </label>
              <input
                value={independentJobRef}
                disabled={isSigned}
                onChange={(e) => setIndependentJobRef(e.target.value)}
                className="mt-1 w-full font-mono font-semibold"
              />
            </div>
          </div>

          {sharedPhotos.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="mb-2 flex items-center gap-1.5 font-semibold text-slate-800">
                <Camera className="h-3.5 w-3.5 text-slate-500" />
                Shared Site Photos ({sharedPhotos.length})
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {sharedPhotos.map((p) => (
                  <a
                    key={p.id}
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt={p.caption || "Site photo"}
                      className="h-28 w-full object-cover transition group-hover:scale-105"
                    />
                    {p.caption && (
                      <div className="truncate bg-white px-2 py-1 text-[10px] text-slate-600">
                        {p.caption}
                      </div>
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Structured BCQ / SACQ / CCQ / MTQ Scope Inputs */}
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <ClipboardList className="h-4 w-4 text-slate-700" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Structured {qtMeta.code} Specification ({qtMeta.label})
              </h2>
              <p className="text-[11px] text-slate-500">{qtMeta.description}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block font-medium text-slate-700">
                Affected Rooms / Zones (comma separated)
              </label>
              <input
                disabled={isSigned}
                value={roomsText}
                onChange={(e) => setRoomsText(e.target.value)}
                placeholder="e.g. Master Bedroom, Ensuite, Hallway, Kitchen"
                className="mt-1 w-full"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">
                {scope.quoteType === "bcq"
                  ? "Biohazard / Contamination Classification"
                  : scope.quoteType === "sacq"
                    ? "Surface Type & Contamination Level"
                    : "Hazard / Scope Classification"}
              </label>
              <input
                disabled={isSigned}
                value={hazardClassification}
                onChange={(e) => setHazardClassification(e.target.value)}
                placeholder={
                  scope.quoteType === "bcq"
                    ? "e.g. Category 3 Biological / Trauma / Gross Filth"
                    : "e.g. Porous & Non-Porous Surface Decontamination"
                }
                className="mt-1 w-full"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">PPE &amp; Containment Controls</label>
              <input
                disabled={isSigned}
                value={ppeAndContainment}
                onChange={(e) => setPpeAndContainment(e.target.value)}
                placeholder="e.g. Tyvek coveralls, P2/P3 respirators, negative air HEPA"
                className="mt-1 w-full"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">Estimated Duration</label>
              <input
                disabled={isSigned}
                value={estimatedDuration}
                onChange={(e) => setEstimatedDuration(e.target.value)}
                placeholder="e.g. 2 days (3 technicians)"
                className="mt-1 w-full"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">Waste &amp; Disposal Protocol</label>
              <input
                disabled={isSigned}
                value={wasteDisposalNotes}
                onChange={(e) => setWasteDisposalNotes(e.target.value)}
                placeholder="e.g. EPA licensed clinical waste bags + manifest"
                className="mt-1 w-full"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">Site Conditions Noted</label>
              <input
                disabled={isSigned}
                value={siteConditions}
                onChange={(e) => setSiteConditions(e.target.value)}
                placeholder="e.g. Power/water connected, lift access confirmed"
                className="mt-1 w-full"
              />
            </div>
          </div>

          <div>
            <div className="font-medium text-slate-700">Standards &amp; Verification Applied</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {standardsList.map((std) => {
                const active = standardsApplied.includes(std);
                return (
                  <button
                    key={std}
                    type="button"
                    disabled={isSigned}
                    onClick={() => toggleStandard(std)}
                    className={`rounded-full border px-3 py-1 text-[11px] font-medium transition ${
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    {std}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700">Scope Summary *</label>
            <textarea
              rows={3}
              disabled={isSigned}
              value={scopeSummary}
              onChange={(e) => setScopeSummary(e.target.value)}
              className="mt-1 w-full"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block font-medium text-slate-700">
                Included Deliverables (one per line)
              </label>
              <textarea
                rows={4}
                disabled={isSigned}
                value={deliverablesText}
                onChange={(e) => setDeliverablesText(e.target.value)}
                className="mt-1 w-full"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700">
                Scope Boundaries &amp; Exclusions (one per line)
              </label>
              <textarea
                rows={4}
                disabled={isSigned}
                value={exclusionsText}
                onChange={(e) => setExclusionsText(e.target.value)}
                className="mt-1 w-full"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700">Additional Estimator Notes</label>
            <input
              disabled={isSigned}
              value={specialNotes}
              onChange={(e) => setSpecialNotes(e.target.value)}
              placeholder="Optional site-specific conditions or assumptions"
              className="mt-1 w-full"
            />
          </div>
        </section>

        {/* Line-Item Pricing */}
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Your Independent Quote Pricing (AUD, Ex GST)
              </h2>
              <p className="text-[11px] text-slate-500">
                Strictly private to {scope.companyName}. Never visible to other participating
                operators.
              </p>
            </div>
            {!isSigned && (
              <button
                type="button"
                onClick={addLineItem}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Line Item
              </button>
            )}
          </div>

          <div className="space-y-2">
            {lineItems.map((li, idx) => (
              <div
                key={li.id}
                className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-12"
              >
                <input
                  disabled={isSigned}
                  value={li.code}
                  onChange={(e) => updateLineItem(idx, { code: e.target.value })}
                  placeholder="Code"
                  className="bg-white font-mono sm:col-span-2"
                />
                <input
                  disabled={isSigned}
                  value={li.description}
                  onChange={(e) => updateLineItem(idx, { description: e.target.value })}
                  placeholder="Work item description..."
                  className="bg-white sm:col-span-4"
                />
                <input
                  disabled={isSigned}
                  value={li.unit}
                  onChange={(e) => updateLineItem(idx, { unit: e.target.value })}
                  placeholder="Unit"
                  className="bg-white sm:col-span-2"
                />
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  disabled={isSigned}
                  value={li.qty}
                  onChange={(e) => updateLineItem(idx, { qty: Number(e.target.value) })}
                  className="bg-white text-right sm:col-span-1"
                />
                <input
                  type="number"
                  step="1"
                  min={0}
                  disabled={isSigned}
                  value={li.unitPrice}
                  onChange={(e) => updateLineItem(idx, { unitPrice: Number(e.target.value) })}
                  className="bg-white text-right sm:col-span-2"
                />
                <div className="flex items-center justify-between sm:col-span-1 sm:justify-end">
                  <span className="font-semibold text-slate-800 sm:hidden">
                    {formatAUD(li.qty * li.unitPrice)}
                  </span>
                  {!isSigned && (
                    <button
                      type="button"
                      onClick={() => removeLineItem(idx)}
                      className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col justify-between gap-4 border-t border-slate-100 pt-4 sm:flex-row sm:items-end">
            <div className="w-full max-w-xs">
              <label className="block font-medium text-slate-700">Deposit Required (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                disabled={isSigned}
                value={depositPercent}
                onChange={(e) => setDepositPercent(Number(e.target.value))}
                className="mt-1 w-32"
              />
            </div>
            <div className="w-full max-w-xs space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal (ex GST)</span>
                <span>{formatAUD(totals.baseSubtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>GST ({scope.gstRegistered ? "10%" : "N/A"})</span>
                <span>{formatAUD(gst)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 text-sm font-bold text-slate-900">
                <span>Total</span>
                <span>{formatAUD(totalIncGst)}</span>
              </div>
              <div className="flex justify-between text-emerald-700 font-semibold">
                <span>Direct Deposit ({depositPercent}%)</span>
                <span>{formatAUD(depositAmount)}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Milestones */}
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Stage {scope.sequenceOrder} Milestones &amp; Handover Gate
            </h2>
            {!isSigned && (
              <button
                type="button"
                onClick={addMilestone}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Milestone
              </button>
            )}
          </div>
          <div className="space-y-2">
            {milestones.map((m, idx) => (
              <div
                key={m.id}
                className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-12"
              >
                <input
                  disabled={isSigned}
                  value={m.title}
                  onChange={(e) =>
                    setMilestones((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x))
                    )
                  }
                  placeholder="Milestone title"
                  className="bg-white sm:col-span-4"
                />
                <input
                  disabled={isSigned}
                  value={m.description}
                  onChange={(e) =>
                    setMilestones((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x))
                    )
                  }
                  placeholder="Description"
                  className="bg-white sm:col-span-4"
                />
                <input
                  disabled={isSigned}
                  value={m.targetDay}
                  onChange={(e) =>
                    setMilestones((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, targetDay: e.target.value } : x))
                    )
                  }
                  placeholder="Day 1"
                  className="bg-white sm:col-span-2"
                />
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700 sm:col-span-2">
                  <input
                    type="checkbox"
                    disabled={isSigned}
                    checked={Boolean(m.isHandoverGate)}
                    onChange={(e) =>
                      setMilestones((prev) =>
                        prev.map((x, i) =>
                          i === idx ? { ...x, isHandoverGate: e.target.checked } : x
                        )
                      )
                    }
                  />
                  Handover Gate
                </label>
              </div>
            ))}
          </div>
        </section>

        {/* Sticky Action Bar */}
        <section className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center">
          <div className="flex items-start gap-2.5 text-slate-600">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-800" />
            <div>
              <div className="font-semibold text-slate-900">
                Separate Entity Dispatch on docs.hazmatmanagement.com.au
              </div>
              <p className="text-[11px]">
                When locked, the Coordinator will send the client a dedicated link for{" "}
                <strong>{scope.companyName}</strong> only, carrying your ABN, T&amp;Cs, signature
                docket, and direct Xero / EFT payment instructions.
              </p>
            </div>
          </div>

          {!isSigned && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={saving || locking}
                onClick={saveDraft}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving…" : "Save Draft"}
              </button>
              <button
                type="button"
                disabled={saving || locking || lineItems.length === 0}
                onClick={handleApproveAndLock}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-5 py-2.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"
              >
                <CheckCircle2 className="h-4 w-4" />
                {locking
                  ? "Locking…"
                  : isLocked
                    ? "Re-Confirm & Lock Quote"
                    : "Approve & Lock Independent Quote"}
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
