"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileCheck2,
  FileSignature,
  Landmark,
  Loader2,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import {
  QUOTE_TYPE_META,
  type DirectoryOpCo,
  type OpCoComplianceDocType,
  type QuoteType,
} from "@/lib/cobid/types";

const STEPS = [
  { id: 1, label: "Entity & Profile" },
  { id: 2, label: "Compliance Vault" },
  { id: 3, label: "Xero & Settlement" },
  { id: 4, label: "Operator Deed" },
  { id: 5, label: "Review & Submit" },
];

const DOC_TYPE_OPTIONS: { value: OpCoComplianceDocType; label: string; required?: boolean }[] = [
  { value: "public_liability", label: "Public Liability Insurance ($20M+)", required: true },
  { value: "workcover", label: "WorkCover / Workers Compensation" },
  { value: "trade_licence", label: "Trade / QBCC / Specialist Licence" },
  { value: "hazmat_licence", label: "Hazmat / EPA / Asbestos Licence" },
  { value: "swms", label: "Safe Work Method Statement (SWMS)" },
  { value: "other", label: "Other Compliance Certificate" },
];

const QUOTE_TYPES: QuoteType[] = ["bcq", "sacq", "ccq", "mtq", "custom"];

function OpCoOnboardingContent() {
  const params = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const token = params?.token || "";

  const [opCo, setOpCo] = useState<DirectoryOpCo | null>(null);
  const [xeroEnabled, setXeroEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ tone: "emerald" | "rose" | "amber"; text: string } | null>(
    null
  );

  // Step 1 form state
  const [legalEntityName, setLegalEntityName] = useState("");
  const [tradingName, setTradingName] = useState("");
  const [tradeCategory, setTradeCategory] = useState("");
  const [abn, setAbn] = useState("");
  const [acn, setAcn] = useState("");
  const [gstRegistered, setGstRegistered] = useState(true);
  const [licenceNumber, setLicenceNumber] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceRegionsText, setServiceRegionsText] = useState("");
  const [allowedQuoteTypes, setAllowedQuoteTypes] = useState<QuoteType[]>(["bcq", "sacq"]);
  const [termsAndConditions, setTermsAndConditions] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Step 2 upload state
  const [docType, setDocType] = useState<OpCoComplianceDocType>("public_liability");
  const [docTitle, setDocTitle] = useState("Public Liability Certificate of Currency");
  const [docNumber, setDocNumber] = useState("");
  const [docIssuer, setDocIssuer] = useState("");
  const [docCoverage, setDocCoverage] = useState("$20,000,000");
  const [docExpiresAt, setDocExpiresAt] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  // Step 3 settlement state
  const [bankName, setBankName] = useState("");
  const [bsb, setBsb] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [payId, setPayId] = useState("");
  const [defaultDepositPercent, setDefaultDepositPercent] = useState(30);
  const [xeroAccountCode, setXeroAccountCode] = useState("200");
  const [xeroInvoiceMode, setXeroInvoiceMode] = useState<"authorised" | "draft">("authorised");

  // Step 4 deed state
  const [deedAck, setDeedAck] = useState(false);
  const [deedSignedBy, setDeedSignedBy] = useState("");
  const [deedSignedTitle, setDeedSignedTitle] = useState("Director");

  const hydrateFromOpCo = useCallback((o: DirectoryOpCo) => {
    setOpCo(o);
    setLegalEntityName(o.legalEntityName || o.companyName || "");
    setTradingName(o.tradingName || o.companyName || "");
    setTradeCategory(o.tradeCategory || "");
    setAbn(o.abn || "");
    setAcn(o.acn || "");
    setGstRegistered(o.gstRegistered !== false);
    setLicenceNumber(o.licenceNumber || "");
    setContactName(o.contactName || "");
    setContactEmail(o.contactEmail || "");
    setPhone(o.phone || "");
    setServiceRegionsText((o.serviceRegions ?? []).join(", "));
    setAllowedQuoteTypes(o.allowedQuoteTypes?.length ? o.allowedQuoteTypes : ["bcq", "sacq"]);
    setTermsAndConditions(o.termsAndConditions || "");
    setBankName(o.bankName || "");
    setBsb(o.bsb || "");
    setAccountNumber(o.accountNumber || "");
    setPayId(o.payId || "");
    setDefaultDepositPercent(o.defaultDepositPercent ?? 30);
    setXeroAccountCode(o.xero?.accountCode || "200");
    setXeroInvoiceMode(o.xero?.invoiceMode === "draft" ? "draft" : "authorised");
    setDeedSignedBy(o.deedSignedBy || o.contactName || "");
    setDeedSignedTitle(o.deedSignedTitle || "Director");
  }, []);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/cobid/onboarding/${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data?.error || "Onboarding link could not be loaded.");
      } else {
        hydrateFromOpCo(data.opCo);
        setXeroEnabled(Boolean(data.xeroEnabled));
      }
    } catch {
      setLoadError("Unable to reach server. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [token, hydrateFromOpCo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const xeroParam = searchParams.get("xero");
    const reason = searchParams.get("reason");
    const tenant = searchParams.get("tenant");
    if (xeroParam === "connected") {
      setStep(3);
      setBanner({
        tone: "emerald",
        text: `Xero connected${tenant ? ` (${tenant})` : ""}! Invoices will now be issued directly from your Xero account.`,
      });
    } else if (xeroParam === "error") {
      setStep(3);
      setBanner({
        tone: "rose",
        text: reason || "Xero connection did not complete. You can retry or enter manual bank details.",
      });
    } else if (xeroParam === "not_configured") {
      setStep(3);
      setBanner({
        tone: "amber",
        text: "Xero OAuth is not configured on this environment yet. Enter direct bank/PayID details below.",
      });
    }
  }, [searchParams]);

  const toggleQuoteType = (qt: QuoteType) => {
    setAllowedQuoteTypes((prev) =>
      prev.includes(qt) ? (prev.length > 1 ? prev.filter((x) => x !== qt) : prev) : [...prev, qt]
    );
  };

  const saveProfilePatch = async (nextStep?: number) => {
    setSaving(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/cobid/onboarding/${encodeURIComponent(token)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalEntityName,
          tradingName,
          companyName: tradingName || legalEntityName,
          tradeCategory,
          abn,
          acn,
          gstRegistered,
          licenceNumber,
          contactName,
          contactEmail,
          phone,
          serviceRegions: serviceRegionsText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          allowedQuoteTypes,
          termsAndConditions,
          bankName,
          bsb,
          accountNumber,
          payId,
          defaultDepositPercent: Number(defaultDepositPercent) || 30,
          xeroSettings: opCo?.xero?.connected
            ? { accountCode: xeroAccountCode, invoiceMode: xeroInvoiceMode }
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ tone: "rose", text: data?.error || "Failed to save progress." });
        return;
      }
      if (data.opCo) hydrateFromOpCo(data.opCo);
      setBanner({ tone: "emerald", text: "Progress saved." });
      if (nextStep) setStep(nextStep);
    } catch {
      setBanner({ tone: "rose", text: "Network error while saving." });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (file: File) => {
    setUploadingLogo(true);
    setBanner(null);
    try {
      const fd = new FormData();
      fd.append("kind", "logo");
      fd.append("file", file);
      const res = await fetch(`/api/cobid/onboarding/${encodeURIComponent(token)}/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ tone: "rose", text: data?.error || "Logo upload failed" });
        return;
      }
      if (data.opCo) hydrateFromOpCo(data.opCo);
      setBanner({ tone: "emerald", text: "Company logo uploaded." });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleDocUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docFile) {
      setBanner({ tone: "rose", text: "Select a PDF or image file first." });
      return;
    }
    setUploadingDoc(true);
    setBanner(null);
    try {
      const fd = new FormData();
      fd.append("kind", "compliance_doc");
      fd.append("docType", docType);
      fd.append("title", docTitle || docFile.name);
      fd.append("documentNumber", docNumber);
      fd.append("issuerOrInsurer", docIssuer);
      fd.append("coverageAmount", docCoverage);
      fd.append("expiresAt", docExpiresAt);
      fd.append("file", docFile);
      const res = await fetch(`/api/cobid/onboarding/${encodeURIComponent(token)}/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ tone: "rose", text: data?.error || "Upload failed" });
        return;
      }
      if (data.opCo) hydrateFromOpCo(data.opCo);
      setDocNumber("");
      setDocIssuer("");
      setDocFile(null);
      setBanner({ tone: "emerald", text: "Compliance certificate uploaded to vault." });
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    const res = await fetch(`/api/cobid/onboarding/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_doc", docId }),
    });
    const data = await res.json();
    if (res.ok && data.opCo) hydrateFromOpCo(data.opCo);
  };

  const handleSignDeed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deedAck || !deedSignedBy.trim()) return;
    setSaving(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/cobid/onboarding/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sign_deed",
          signedBy: deedSignedBy.trim(),
          signedTitle: deedSignedTitle.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ tone: "rose", text: data?.error || "Failed to execute deed" });
        return;
      }
      if (data.opCo) hydrateFromOpCo(data.opCo);
      setBanner({ tone: "emerald", text: "Independent Operator Platform Deed signed." });
      setStep(5);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitForReview = async () => {
    setSaving(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/cobid/onboarding/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit_for_review" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ tone: "rose", text: data?.error || "Could not submit for review" });
        return;
      }
      if (data.opCo) hydrateFromOpCo(data.opCo);
      setBanner({
        tone: "emerald",
        text: "Submitted for Coordinator approval! We will verify your documents and activate your profile.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-xs text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading Independent Operator Onboarding Portal…
      </div>
    );
  }

  if (loadError || !opCo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" />
          <h1 className="mt-3 text-base font-semibold text-slate-900">Onboarding Link Unavailable</h1>
          <p className="mt-1.5 text-xs text-slate-600">{loadError || "Invalid onboarding link."}</p>
        </div>
      </div>
    );
  }

  const hasValidPL = opCo.complianceDocs.some(
    (d) => d.docType === "public_liability" && d.status !== "rejected" && !d.isExpired
  );
  const hasSettlement =
    opCo.xero.connected || Boolean((bsb.trim() && accountNumber.trim()) || payId.trim());
  const hasDeed = Boolean(opCo.deedSignedAt && opCo.deedAuditHash);
  const hasEntityBasics = Boolean(legalEntityName.trim() && abn.trim() && contactName.trim() && contactEmail.trim());
  const readyToSubmit = hasEntityBasics && hasValidPL && hasSettlement && hasDeed;

  const logoSrc = opCo.logoPath
    ? `/api/cobid/files?path=${encodeURIComponent(opCo.logoPath)}&onboardingToken=${encodeURIComponent(token)}`
    : null;

  return (
    <div className="min-h-screen bg-slate-50 pb-16 text-slate-900">
      <header className="border-b border-slate-200 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-xs font-bold text-slate-950">
              HM
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Hazmat Management Co-Bid · Independent Operator Onboarding
              </div>
              <h1 className="text-base font-semibold">{opCo.tradingName || opCo.companyName}</h1>
            </div>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${
              opCo.onboardingStatus === "approved"
                ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                : opCo.onboardingStatus === "pending_review"
                  ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                  : opCo.onboardingStatus === "suspended"
                    ? "bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/40"
                    : "bg-slate-800 text-slate-200"
            }`}
          >
            {opCo.onboardingStatus.replace(/_/g, " ")}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pt-6 sm:px-6">
        {opCo.reviewNotes && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div>
              <div className="font-semibold">Coordinator Review Notes</div>
              <p className="mt-0.5">{opCo.reviewNotes}</p>
            </div>
          </div>
        )}

        {opCo.onboardingStatus === "approved" && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-950">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div>
              <div className="font-semibold">Profile Approved & Active</div>
              <p className="mt-0.5">
                Your independent operator profile is approved to receive Co-Bid job invitations. You
                can still upload renewed insurance certificates or reconnect Xero here anytime.
              </p>
            </div>
          </div>
        )}

        {/* Stepper */}
        <nav className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {STEPS.map((s) => {
            const active = step === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setStep(s.id)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition ${
                  active
                    ? "border-slate-900 bg-slate-900 text-white shadow-xs"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    active ? "bg-white text-slate-900" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {s.id}
                </span>
                <span className="truncate">{s.label}</span>
              </button>
            );
          })}
        </nav>

        {banner && (
          <div
            className={`mb-5 rounded-xl border px-4 py-3 text-xs font-medium ${
              banner.tone === "emerald"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : banner.tone === "amber"
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {banner.text}
          </div>
        )}

        {/* STEP 1: Entity, ABN/ACN, GST, Logo, Contact, Quote Types, Own T&Cs */}
        {step === 1 && (
          <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 text-xs shadow-xs">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <Building2 className="h-4 w-4 text-slate-700" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  1. Independent Entity Identity & Terms
                </h2>
                <p className="text-[11px] text-slate-500">
                  Your legal name, ABN, logo, and own T&amp;Cs appear on every client quote &amp;
                  agreement issued under your company.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block font-medium text-slate-700">Legal Entity Name *</label>
                <input
                  value={legalEntityName}
                  onChange={(e) => setLegalEntityName(e.target.value)}
                  placeholder="e.g. Acme Remediation Pty Ltd"
                  className="mt-1 w-full"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">Trading Name *</label>
                <input
                  value={tradingName}
                  onChange={(e) => setTradingName(e.target.value)}
                  placeholder="Displayed on quotes & agreements"
                  className="mt-1 w-full"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">Primary Trade Category *</label>
                <input
                  value={tradeCategory}
                  onChange={(e) => setTradeCategory(e.target.value)}
                  className="mt-1 w-full"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">Primary Licence / Certification #</label>
                <input
                  value={licenceNumber}
                  onChange={(e) => setLicenceNumber(e.target.value)}
                  placeholder="e.g. IICRC / QBCC / EPA Licence"
                  className="mt-1 w-full"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">ABN *</label>
                <input
                  value={abn}
                  onChange={(e) => setAbn(e.target.value)}
                  placeholder="00 000 000 000"
                  className="mt-1 w-full"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">ACN (optional)</label>
                <input
                  value={acn}
                  onChange={(e) => setAcn(e.target.value)}
                  placeholder="000 000 000"
                  className="mt-1 w-full"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">Primary Estimator Contact *</label>
                <input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="mt-1 w-full"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">Estimator Email *</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="mt-1 w-full"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">Phone</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0400 000 000"
                  className="mt-1 w-full"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">Service Regions (comma separated)</label>
                <input
                  value={serviceRegionsText}
                  onChange={(e) => setServiceRegionsText(e.target.value)}
                  placeholder="Brisbane, Gold Coast, Sunshine Coast"
                  className="mt-1 w-full"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="flex cursor-pointer items-center gap-2 font-medium text-slate-800">
                <input
                  type="checkbox"
                  checked={gstRegistered}
                  onChange={(e) => setGstRegistered(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Registered for Australian GST (10%)
              </label>

              <div className="flex items-center gap-3">
                {logoSrc && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoSrc}
                    alt="Company logo"
                    className="h-10 max-w-[120px] rounded border border-slate-200 bg-white object-contain p-1"
                  />
                )}
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-50">
                  <Upload className="h-3.5 w-3.5" />
                  {uploadingLogo ? "Uploading…" : logoSrc ? "Replace Logo" : "Upload Logo (PNG/JPG)"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleLogoUpload(f);
                    }}
                  />
                </label>
              </div>
            </div>

            <div>
              <div className="font-semibold text-slate-800">Quote Builder Types You Offer</div>
              <p className="text-[11px] text-slate-500">
                Select which structured quote builders your company quotes on.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {QUOTE_TYPES.map((qt) => {
                  const meta = QUOTE_TYPE_META[qt];
                  const selected = allowedQuoteTypes.includes(qt);
                  return (
                    <button
                      key={qt}
                      type="button"
                      onClick={() => toggleQuoteType(qt)}
                      className={`rounded-xl border p-3 text-left transition ${
                        selected
                          ? "border-slate-900 bg-slate-900/5"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">
                          {meta.code} — {meta.label}
                        </span>
                        {selected && <CheckCircle2 className="h-4 w-4 text-slate-900" />}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">{meta.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-800">
                Your Company&apos;s Own Standard Terms &amp; Conditions
              </label>
              <p className="text-[11px] text-slate-500">
                Embedded verbatim into every client agreement issued under your company on
                docs.hazmatmanagement.com.au.
              </p>
              <textarea
                rows={5}
                value={termsAndConditions}
                onChange={(e) => setTermsAndConditions(e.target.value)}
                placeholder="Paste your standard customer terms, payment terms, warranty & cancellation clauses..."
                className="mt-1.5 w-full"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                disabled={saving}
                onClick={() => saveProfilePatch(2)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save & Continue to Compliance Vault"}
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Compliance & Insurance Vault */}
        {step === 2 && (
          <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 text-xs shadow-xs">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <ShieldCheck className="h-4 w-4 text-slate-700" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  2. Compliance & Insurance Vault
                </h2>
                <p className="text-[11px] text-slate-500">
                  Upload current certificates with expiry dates. A valid, unexpired Public Liability
                  certificate is mandatory before approval.
                </p>
              </div>
            </div>

            <form
              onSubmit={handleDocUpload}
              className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
            >
              <div className="font-semibold text-slate-900">Upload Compliance Certificate</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-medium text-slate-700">Document Type *</label>
                  <select
                    value={docType}
                    onChange={(e) => {
                      const v = e.target.value as OpCoComplianceDocType;
                      setDocType(v);
                      const opt = DOC_TYPE_OPTIONS.find((o) => o.value === v);
                      if (opt) setDocTitle(opt.label);
                    }}
                    className="mt-1 w-full bg-white"
                  >
                    {DOC_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Document Title</label>
                  <input
                    value={docTitle}
                    onChange={(e) => setDocTitle(e.target.value)}
                    className="mt-1 w-full bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Policy / Licence Number</label>
                  <input
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                    placeholder="e.g. POL-884120"
                    className="mt-1 w-full bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Insurer / Issuing Authority</label>
                  <input
                    value={docIssuer}
                    onChange={(e) => setDocIssuer(e.target.value)}
                    placeholder="e.g. QBE / WorkCover QLD / QBCC"
                    className="mt-1 w-full bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Coverage Amount (if insurance)</label>
                  <input
                    value={docCoverage}
                    onChange={(e) => setDocCoverage(e.target.value)}
                    placeholder="$20,000,000"
                    className="mt-1 w-full bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Expiry Date *</label>
                  <input
                    type="date"
                    required
                    value={docExpiresAt}
                    onChange={(e) => setDocExpiresAt(e.target.value)}
                    className="mt-1 w-full bg-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700">PDF or Certificate Image *</label>
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                    className="mt-1 w-full bg-white"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={uploadingDoc}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {uploadingDoc ? "Uploading…" : "Upload to Compliance Vault"}
                </button>
              </div>
            </form>

            <div className="space-y-2">
              <div className="font-semibold text-slate-800">
                Uploaded Documents ({opCo.complianceDocs.length})
              </div>
              {opCo.complianceDocs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
                  No certificates uploaded yet. Upload your Public Liability Certificate of Currency
                  above to continue.
                </div>
              ) : (
                opCo.complianceDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">{doc.title}</span>
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
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {doc.issuerOrInsurer ? `${doc.issuerOrInsurer} · ` : ""}
                        {doc.documentNumber ? `#${doc.documentNumber} · ` : ""}
                        {doc.coverageAmount ? `${doc.coverageAmount} · ` : ""}
                        Expires: {doc.expiresAt || "Not set"}
                      </div>
                      {doc.rejectionReason && (
                        <div className="mt-1 text-[11px] font-medium text-rose-700">
                          Rejected: {doc.rejectionReason}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={`/api/cobid/files?path=${encodeURIComponent(doc.filePath)}&onboardingToken=${encodeURIComponent(token)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        View
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <button
                        type="button"
                        onClick={() => handleDeleteDoc(doc.id)}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        title="Remove document"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-between border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white hover:bg-slate-800"
              >
                Continue to Xero &amp; Settlement
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Direct Invoicing (Xero OAuth + Manual EFT Fallback) */}
        {step === 3 && (
          <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 text-xs shadow-xs">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <Landmark className="h-4 w-4 text-slate-700" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  3. Direct Invoicing &amp; Settlement (Your Own Entity)
                </h2>
                <p className="text-[11px] text-slate-500">
                  Clients pay your company directly — never via Hazmat Management. Connect your Xero
                  account for instant automated invoices &amp; Pay Now links, or provide manual EFT
                  details as fallback.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      Connect Your Xero Account
                    </span>
                    {opCo.xero.connected ? (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                        Verified Xero Auto-Invoicing
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-[10px] font-semibold text-slate-700">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-600">
                    {opCo.xero.connected
                      ? `Connected to Xero organisation: ${opCo.xero.tenantName || "Active"}. Minimal permissions (contacts & invoices only — zero access to bank feeds, payroll, or P&L).`
                      : "Minimal scopes only (contacts & invoices). When a client signs your quote, we automatically create the deposit invoice inside your Xero and show your Xero Online Pay link."}
                  </p>
                </div>
                <a
                  href={`/api/cobid/xero/connect?onboardingToken=${encodeURIComponent(token)}`}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#13B5EA] px-4 py-2.5 font-semibold text-white shadow-xs hover:bg-[#0ea3d4]"
                >
                  {opCo.xero.connected ? "Reconnect Xero" : "Connect Xero"}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>

              {opCo.xero.connected && (
                <div className="mt-4 grid gap-3 border-t border-slate-200 pt-3 sm:grid-cols-2">
                  <div>
                    <label className="block font-medium text-slate-700">Sales Account Code</label>
                    <input
                      value={xeroAccountCode}
                      onChange={(e) => setXeroAccountCode(e.target.value)}
                      className="mt-1 w-full bg-white"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700">Invoice Creation Mode</label>
                    <select
                      value={xeroInvoiceMode}
                      onChange={(e) =>
                        setXeroInvoiceMode(e.target.value === "draft" ? "draft" : "authorised")
                      }
                      className="mt-1 w-full bg-white"
                    >
                      <option value="authorised">
                        Authorised (instant Xero Online Pay Now link)
                      </option>
                      <option value="draft">Draft (approve manually inside Xero)</option>
                    </select>
                  </div>
                </div>
              )}

              {!xeroEnabled && !opCo.xero.connected && (
                <div className="mt-2 text-[11px] text-slate-500">
                  Note: If Xero OAuth credentials are not yet active on this server, enter your
                  direct bank/PayID details below.
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="font-semibold text-slate-800">
                Direct Bank Transfer / PayID Fallback Details
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-medium text-slate-700">Bank Name</label>
                  <input
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="e.g. Commonwealth Bank"
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">BSB</label>
                  <input
                    value={bsb}
                    onChange={(e) => setBsb(e.target.value)}
                    placeholder="064-000"
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Account Number</label>
                  <input
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="1234 5678"
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">PayID (Email or ABN)</label>
                  <input
                    value={payId}
                    onChange={(e) => setPayId(e.target.value)}
                    placeholder="accounts@yourcompany.com.au"
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Default Deposit %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={defaultDepositPercent}
                    onChange={(e) => setDefaultDepositPercent(Number(e.target.value))}
                    className="mt-1 w-full"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-between border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => saveProfilePatch(4)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save & Continue to Operator Deed"}
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: Independent Operator Platform Deed */}
        {step === 4 && (
          <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 text-xs shadow-xs">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <FileSignature className="h-4 w-4 text-slate-700" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  4. Independent Operator Platform Deed
                </h2>
                <p className="text-[11px] text-slate-500">
                  Confirms strict legal separation — not a partnership, joint venture, or
                  subcontracting relationship.
                </p>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 leading-relaxed text-slate-700">
              <p>
                <strong>1. Strictly Independent Legal Entity:</strong>{" "}
                {legalEntityName || opCo.companyName} (ABN {abn || opCo.abn || "TBA"}) participates
                on the Hazmat Management Co-Bid platform strictly as an independent contracting
                entity. Nothing in this Deed or any coordinated job workspace creates a partnership,
                joint venture, agency, employment, or head-contractor/subcontractor relationship
                between the Operator, Hazmat Management, or any other participating company.
              </p>
              <p>
                <strong>2. Direct Bilateral Contracting &amp; Invoicing:</strong> The Operator
                reviews, approves, and issues its own separate scope, quote, agreement, and tax
                invoice directly to each Client under its own ABN and terms. The Operator bears sole
                responsibility for its workmanship, statutory warranties, GST obligations, and
                regulatory compliance.
              </p>
              <p>
                <strong>3. Commercial Ring-Fencing &amp; Confidentiality:</strong> Pricing, scopes,
                and commercial records of other operators are strictly confidential and ring-fenced.
                The Operator agrees to coordinate site access and handover gates professionally
                while maintaining strict independent liability boundaries.
              </p>
              <p>
                <strong>4. Continuous Insurance &amp; Licence Maintenance:</strong> The Operator
                warrants that all insurances (including Public Liability and WorkCover where
                applicable) and trade/hazmat licences uploaded to the Compliance Vault are current
                and valid, and acknowledges that expired compliance automatically suspends job
                invitations until renewed certificates are verified.
              </p>
            </div>

            {hasDeed ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Deed Executed Electronically by {opCo.deedSignedBy} ({opCo.deedSignedTitle})
                </div>
                <div className="mt-1 font-mono text-[11px] text-emerald-800">
                  Audit Digest: {opCo.deedAuditHash} · Signed:{" "}
                  {opCo.deedSignedAt ? new Date(opCo.deedSignedAt).toLocaleString("en-AU") : ""}
                </div>
              </div>
            ) : (
              <form onSubmit={handleSignDeed} className="space-y-4">
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5">
                  <input
                    type="checkbox"
                    checked={deedAck}
                    onChange={(e) => setDeedAck(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  />
                  <span className="text-slate-700">
                    I am authorised to bind <strong>{legalEntityName || opCo.companyName}</strong>{" "}
                    and execute this Independent Operator Platform Deed electronically under the
                    Electronic Transactions Act.
                  </span>
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block font-medium text-slate-700">
                      Authorised Signatory Full Name *
                    </label>
                    <input
                      required
                      value={deedSignedBy}
                      onChange={(e) => setDeedSignedBy(e.target.value)}
                      className="mt-1 w-full font-serif text-base italic"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700">Role / Title</label>
                    <input
                      value={deedSignedTitle}
                      onChange={(e) => setDeedSignedTitle(e.target.value)}
                      placeholder="Director / Principal"
                      className="mt-1 w-full"
                    />
                  </div>
                </div>

                <div className="flex justify-between border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={!deedAck || !deedSignedBy.trim() || saving}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
                  >
                    <FileSignature className="h-4 w-4" />
                    {saving ? "Signing…" : "Sign Independent Operator Deed"}
                  </button>
                </div>
              </form>
            )}

            {hasDeed && (
              <div className="flex justify-between border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(5)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white hover:bg-slate-800"
                >
                  Continue to Final Review
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* STEP 5: Review & Submit */}
        {step === 5 && (
          <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 text-xs shadow-xs">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <FileCheck2 className="h-4 w-4 text-slate-700" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  5. Readiness Checklist &amp; Submit for Approval
                </h2>
                <p className="text-[11px] text-slate-500">
                  Once submitted, our Coordinator reviews your compliance vault and activates your
                  profile for Co-Bid job invitations.
                </p>
              </div>
            </div>

            <div className="space-y-2.5">
              {[
                {
                  ok: hasEntityBasics,
                  label: "Entity details, ABN & estimator contact completed",
                  stepId: 1,
                },
                {
                  ok: hasValidPL,
                  label: "Current, unexpired Public Liability Insurance uploaded",
                  stepId: 2,
                },
                {
                  ok: hasSettlement,
                  label: opCo.xero.connected
                    ? `Xero connected (${opCo.xero.tenantName || "Active"})`
                    : "Direct Bank / PayID settlement details configured",
                  stepId: 3,
                },
                {
                  ok: hasDeed,
                  label: "Independent Operator Platform Deed signed electronically",
                  stepId: 4,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className={`flex items-center justify-between rounded-xl border p-3.5 ${
                    item.ok
                      ? "border-emerald-200 bg-emerald-50/70 text-emerald-950"
                      : "border-amber-200 bg-amber-50 text-amber-950"
                  }`}
                >
                  <div className="flex items-center gap-2 font-medium">
                    {item.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                    )}
                    {item.label}
                  </div>
                  {!item.ok && (
                    <button
                      type="button"
                      onClick={() => setStep(item.stepId)}
                      className="rounded-md bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-800 shadow-2xs"
                    >
                      Complete Step {item.stepId}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {opCo.onboardingStatus === "pending_review" ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                <div className="font-semibold">Awaiting Coordinator Verification</div>
                <p className="mt-1">
                  Your onboarding package has been submitted and is in the review queue. Once
                  approved, you will be eligible to receive BCQ/SACQ quote invitations.
                </p>
              </div>
            ) : opCo.onboardingStatus === "approved" ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                <div className="font-semibold">Approved Independent Operator</div>
                <p className="mt-1">
                  Approved{opCo.approvedBy ? ` by ${opCo.approvedBy}` : ""}. Keep your insurances
                  current here so invitations are never interrupted.
                </p>
              </div>
            ) : (
              <div className="flex justify-between border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>
                <button
                  type="button"
                  disabled={!readyToSubmit || saving}
                  onClick={handleSubmitForReview}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {saving ? "Submitting…" : "Submit Profile for Coordinator Approval"}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default function OpCoOnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50 text-xs text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading Independent Operator Onboarding Portal…
        </div>
      }
    >
      <OpCoOnboardingContent />
    </Suspense>
  );
}
