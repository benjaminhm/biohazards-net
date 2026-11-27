import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { clientIpFromRequest, userAgentFromRequest } from "@/lib/portalAuth";
import { getOpCoByOnboardingToken } from "@/lib/cobid/store";
import { xeroConfigured } from "@/lib/cobid/xero";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const found = await getOpCoByOnboardingToken(token);
    if (!found) {
      return NextResponse.json({ error: "Onboarding link not found or revoked" }, { status: 404 });
    }
    if (found.expired) {
      return NextResponse.json(
        { error: "This onboarding link has expired. Ask the Coordinator to resend a fresh link." },
        { status: 410 }
      );
    }

    return NextResponse.json({
      opCo: found.opCo,
      xeroEnabled: xeroConfigured(),
    });
  } catch (err) {
    console.error("GET /api/cobid/onboarding/[token] error:", err);
    return NextResponse.json({ error: "Failed to load onboarding state" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const found = await getOpCoByOnboardingToken(token);
    if (!found) {
      return NextResponse.json({ error: "Onboarding link not found" }, { status: 404 });
    }
    if (found.expired) {
      return NextResponse.json({ error: "Onboarding link has expired" }, { status: 410 });
    }

    const body = await req.json();
    const supabase = createServiceClient();
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    const strField = (bodyKey: string, dbCol: string) => {
      if (typeof body[bodyKey] === "string") {
        update[dbCol] = body[bodyKey].trim();
      }
    };

    strField("companyName", "company_name");
    strField("legalEntityName", "legal_entity_name");
    strField("tradingName", "trading_name");
    strField("tradeCategory", "trade_category");
    strField("abn", "abn");
    strField("acn", "acn");
    strField("licenceNumber", "licence_number");
    strField("contactName", "contact_name");
    strField("contactEmail", "contact_email");
    strField("phone", "phone");
    strField("termsAndConditions", "terms_and_conditions");
    strField("bankName", "bank_name");
    strField("bsb", "bsb");
    strField("accountNumber", "account_number");
    strField("payId", "pay_id");
    strField("defaultScopeSummary", "default_scope_summary");

    if (typeof body.gstRegistered === "boolean") {
      update.gst_registered = body.gstRegistered;
    }
    if (typeof body.defaultDepositPercent === "number" && Number.isFinite(body.defaultDepositPercent)) {
      update.default_deposit_pct = Math.max(0, Math.min(100, Math.round(body.defaultDepositPercent)));
    }
    if (Array.isArray(body.serviceRegions)) {
      update.service_regions = body.serviceRegions
        .filter((s: unknown): s is string => typeof s === "string")
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    if (Array.isArray(body.allowedQuoteTypes)) {
      const valid = new Set(["bcq", "sacq", "ccq", "mtq", "custom"]);
      const filtered = body.allowedQuoteTypes.filter(
        (q: unknown): q is string => typeof q === "string" && valid.has(q)
      );
      if (filtered.length > 0) update.allowed_quote_types = filtered;
    }

    // Update monogram if trading/company name changed
    const nextName =
      (typeof body.tradingName === "string" && body.tradingName.trim()) ||
      (typeof body.companyName === "string" && body.companyName.trim());
    if (nextName) {
      update.company_name = nextName;
      update.monogram = (
        nextName
          .split(/\s+/)
          .map((w: string) => w[0])
          .join("")
          .slice(0, 2) || found.opCo.monogram
      ).toUpperCase();
    }

    // Advance invited -> in_progress automatically on first save
    if (found.opCo.onboardingStatus === "invited") {
      update.onboarding_status = "in_progress";
    }

    const { error } = await supabase
      .from("cobid_opcos")
      .update(update)
      .eq("id", found.opCo.id)
      .eq("org_id", found.orgId);

    if (error) throw new Error(error.message);

    // Optional Xero invoice preferences update if connected
    if (body.xeroSettings && typeof body.xeroSettings === "object") {
      const xs = body.xeroSettings as { accountCode?: string; invoiceMode?: string };
      const xeroPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof xs.accountCode === "string" && xs.accountCode.trim()) {
        xeroPatch.account_code = xs.accountCode.trim();
      }
      if (xs.invoiceMode === "authorised" || xs.invoiceMode === "draft") {
        xeroPatch.invoice_mode = xs.invoiceMode;
      }
      await supabase
        .from("cobid_opco_xero_connections")
        .update(xeroPatch)
        .eq("opco_id", found.opCo.id)
        .eq("org_id", found.orgId);
    }

    const reloaded = await getOpCoByOnboardingToken(token);
    return NextResponse.json({ opCo: reloaded?.opCo, xeroEnabled: xeroConfigured() });
  } catch (err) {
    console.error("PATCH /api/cobid/onboarding/[token] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save onboarding details" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const found = await getOpCoByOnboardingToken(token);
    if (!found) {
      return NextResponse.json({ error: "Onboarding link not found" }, { status: 404 });
    }
    if (found.expired) {
      return NextResponse.json({ error: "Onboarding link has expired" }, { status: 410 });
    }

    const body = await req.json();
    const action = String(body?.action ?? "");
    const supabase = createServiceClient();

    if (action === "sign_deed") {
      const signedBy = String(body?.signedBy ?? "").trim();
      const signedTitle = String(body?.signedTitle ?? "").trim();
      if (!signedBy) {
        return NextResponse.json({ error: "Full legal name of authorised signatory is required" }, { status: 400 });
      }
      const ip = clientIpFromRequest(req);
      const ua = userAgentFromRequest(req);
      const now = new Date().toISOString();
      const digest = `DEED-SHA256:${crypto
        .createHash("sha256")
        .update(`${found.opCo.id}:${found.opCo.abn}:${signedBy}:${signedTitle}:${ip}:${now}`)
        .digest("hex")
        .slice(0, 16)}`;

      const nextStatus =
        found.opCo.onboardingStatus === "invited" ? "in_progress" : found.opCo.onboardingStatus;

      const { error } = await supabase
        .from("cobid_opcos")
        .update({
          deed_signed_at: now,
          deed_signed_by: signedBy,
          deed_signed_title: signedTitle || "Director / Authorised Officer",
          deed_signed_ip: ip,
          deed_signed_ua: ua,
          deed_audit_hash: digest,
          onboarding_status: nextStatus,
          updated_at: now,
        })
        .eq("id", found.opCo.id)
        .eq("org_id", found.orgId);

      if (error) throw new Error(error.message);
      const reloaded = await getOpCoByOnboardingToken(token);
      return NextResponse.json({ opCo: reloaded?.opCo });
    }

    if (action === "submit_for_review") {
      const opCo = found.opCo;
      const missing: string[] = [];
      if (!opCo.legalEntityName?.trim()) missing.push("Legal entity name");
      if (!opCo.abn?.trim()) missing.push("ABN");
      if (!opCo.contactName?.trim() || !opCo.contactEmail?.trim()) {
        missing.push("Primary estimator contact name & email");
      }
      const hasPL = opCo.complianceDocs.some(
        (d) => d.docType === "public_liability" && d.status !== "rejected" && !d.isExpired
      );
      if (!hasPL) missing.push("Current Public Liability Insurance certificate");

      const hasPayment =
        opCo.xero.connected ||
        Boolean((opCo.bsb?.trim() && opCo.accountNumber?.trim()) || opCo.payId?.trim());
      if (!hasPayment) missing.push("Xero connection or direct bank/PayID details");

      if (!opCo.deedSignedAt || !opCo.deedAuditHash) {
        missing.push("Signed Independent Operator Platform Deed");
      }

      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Please complete before submitting: ${missing.join(", ")}.`, missing },
          { status: 400 }
        );
      }

      const { error } = await supabase
        .from("cobid_opcos")
        .update({
          onboarding_status: "pending_review",
          review_notes: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", opCo.id)
        .eq("org_id", found.orgId);

      if (error) throw new Error(error.message);
      const reloaded = await getOpCoByOnboardingToken(token);
      return NextResponse.json({ opCo: reloaded?.opCo });
    }

    if (action === "delete_doc") {
      const docId = String(body?.docId ?? "");
      if (!docId) {
        return NextResponse.json({ error: "docId is required" }, { status: 400 });
      }
      const { data: docRow } = await supabase
        .from("cobid_opco_compliance_docs")
        .select("file_path")
        .eq("id", docId)
        .eq("opco_id", found.opCo.id)
        .eq("org_id", found.orgId)
        .maybeSingle();

      if (docRow?.file_path) {
        await supabase.storage.from("cobid-files").remove([String(docRow.file_path)]).catch(() => {});
      }

      await supabase
        .from("cobid_opco_compliance_docs")
        .delete()
        .eq("id", docId)
        .eq("opco_id", found.opCo.id)
        .eq("org_id", found.orgId);

      const reloaded = await getOpCoByOnboardingToken(token);
      return NextResponse.json({ opCo: reloaded?.opCo });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error("POST /api/cobid/onboarding/[token] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed" },
      { status: 500 }
    );
  }
}
