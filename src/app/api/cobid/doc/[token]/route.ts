import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { clientIpFromRequest, userAgentFromRequest } from "@/lib/portalAuth";
import { addCobidAuditEvent, hashCobidToken } from "@/lib/cobid/store";
import { buildCobidPackageUrl } from "@/lib/cobid/hosts";
import { raiseOpCoXeroInvoice } from "@/lib/cobid/xero";
import { calcTotals, nowAuLabel } from "@/lib/cobid/utils";
import { QUOTE_TYPE_META, type LineItem, type QuoteType } from "@/lib/cobid/types";

async function loadPublicDoc(req: NextRequest, token: string) {
  if (!token || token.length < 16) return null;
  const supabase = createServiceClient();
  const hash = hashCobidToken(token);

  const { data: scopeRow, error } = await supabase
    .from("cobid_scopes")
    .select("*")
    .eq("doc_token_hash", hash)
    .maybeSingle();

  if (error || !scopeRow) return null;

  const [wsRes, liRes, opcoRes] = await Promise.all([
    supabase
      .from("cobid_workspaces")
      .select(
        "id, org_id, reference, property_address, suburb_state, client_name, client_role, client_email, settlement_rail, package_token"
      )
      .eq("id", scopeRow.workspace_id)
      .single(),
    supabase
      .from("cobid_line_items")
      .select("*")
      .eq("scope_id", scopeRow.id)
      .order("sort_order", { ascending: true }),
    scopeRow.directory_opco_id
      ? supabase
          .from("cobid_opcos")
          .select("legal_entity_name, trading_name, acn, gst_registered, phone, logo_path")
          .eq("id", scopeRow.directory_opco_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (wsRes.error || !wsRes.data) return null;
  const ws = wsRes.data as Record<string, unknown>;

  const lineItems: LineItem[] = ((liRes.data ?? []) as Array<Record<string, unknown>>).map(
    (r) => ({
      id: String(r.id),
      code: String(r.code),
      description: String(r.description),
      unit: String(r.unit),
      qty: Number(r.qty),
      unitPrice: Number(r.unit_price),
      category: String(r.category),
    })
  );

  const gstRegistered = opcoRes.data?.gst_registered !== false;
  const depositPercent = Number(scopeRow.deposit_percent ?? 30);
  const totals = calcTotals(lineItems, depositPercent);
  const gst = gstRegistered ? totals.baseSubtotal * 0.1 : 0;
  const totalIncGst = totals.baseSubtotal + gst;
  const depositAmount = totalIncGst * (depositPercent / 100);
  const qt = (String(scopeRow.quote_type || "custom") as QuoteType);
  const qtMeta = QUOTE_TYPE_META[qt] ?? QUOTE_TYPE_META.custom;

  const expired =
    Boolean(scopeRow.doc_expires_at) &&
    new Date(String(scopeRow.doc_expires_at)).getTime() < Date.now() &&
    scopeRow.doc_status !== "signed";

  return {
    expired,
    orgId: String(scopeRow.org_id),
    workspaceId: String(scopeRow.workspace_id),
    scopeId: String(scopeRow.id),
    doc: {
      companyName: String(scopeRow.company_name),
      legalEntityName: opcoRes.data?.legal_entity_name || String(scopeRow.company_name),
      tradingName: opcoRes.data?.trading_name || String(scopeRow.company_name),
      abn: String(scopeRow.abn || ""),
      acn: opcoRes.data?.acn || "",
      licenceNumber: String(scopeRow.licence_number || ""),
      monogram: String(scopeRow.monogram || "OP"),
      contactName: String(scopeRow.contact_name || ""),
      contactEmail: String(scopeRow.contact_email || ""),
      phone: opcoRes.data?.phone || "",
      logoUrl: opcoRes.data?.logo_path
        ? `/api/cobid/files?path=${encodeURIComponent(String(opcoRes.data.logo_path))}&docToken=${encodeURIComponent(token)}`
        : null,
      tradeCategory: String(scopeRow.trade_category),
      quoteType: qt,
      quoteTypeCode: qtMeta.code,
      quoteTypeLabel: qtMeta.label,
      stageOrder: Number(scopeRow.sequence_order),
      independentJobRef: String(scopeRow.independent_job_ref || scopeRow.agreement_ref),
      agreementRef: String(scopeRow.agreement_ref),
      docStatus: String(scopeRow.doc_status || "open"),
      agreementStatus: String(scopeRow.agreement_status || "sent_to_client"),
      snapshotHtml: String(scopeRow.doc_snapshot_html || ""),
      propertyAddress: String(ws.property_address),
      suburbState: String(ws.suburb_state || ""),
      clientName: String(ws.client_name),
      clientEmail: String(ws.client_email || ""),
      settlementRail: String(ws.settlement_rail || "direct_to_opco"),
      subtotalExGst: totals.baseSubtotal,
      gst,
      gstRegistered,
      totalIncGst,
      depositPercent,
      depositAmount,
      clientSignedAt: scopeRow.client_signed_at ? String(scopeRow.client_signed_at) : null,
      clientSignedBy: scopeRow.client_signed_by ? String(scopeRow.client_signed_by) : null,
      agreementAuditHash: scopeRow.agreement_audit_hash
        ? String(scopeRow.agreement_audit_hash)
        : null,
      docDeclineReason: scopeRow.doc_decline_reason
        ? String(scopeRow.doc_decline_reason)
        : null,
      bankName: String(scopeRow.bank_name || ""),
      bsb: String(scopeRow.bsb || ""),
      accountNumber: String(scopeRow.account_number || ""),
      payId: String(scopeRow.pay_id || ""),
      depositStatus: String(scopeRow.deposit_status || "pending"),
      depositPaidAt: scopeRow.deposit_paid_at ? String(scopeRow.deposit_paid_at) : null,
      xeroDepositInvoiceNumber: scopeRow.xero_deposit_invoice_number
        ? String(scopeRow.xero_deposit_invoice_number)
        : null,
      xeroDepositOnlineUrl: scopeRow.xero_deposit_online_url
        ? String(scopeRow.xero_deposit_online_url)
        : null,
      xeroLastError: scopeRow.xero_last_error ? String(scopeRow.xero_last_error) : null,
      pdfUrl: `/api/cobid/doc/${encodeURIComponent(token)}/pdf`,
      packageUrl: ws.package_token
        ? buildCobidPackageUrl(req, String(ws.package_token))
        : null,
    },
  };
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const loaded = await loadPublicDoc(req, token);
    if (!loaded) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (loaded.expired) {
      return NextResponse.json({ error: "This quote link has expired" }, { status: 410 });
    }

    const supabase = createServiceClient();
    await supabase
      .from("cobid_scopes")
      .update({ doc_viewed_at: new Date().toISOString() })
      .eq("id", loaded.scopeId)
      .is("doc_viewed_at", null);

    return NextResponse.json({ document: loaded.doc });
  } catch (err) {
    console.error("GET /api/cobid/doc/[token] error:", err);
    return NextResponse.json({ error: "Failed to load document" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const loaded = await loadPublicDoc(req, token);
    if (!loaded) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (loaded.expired) {
      return NextResponse.json({ error: "This quote link has expired" }, { status: 410 });
    }

    const body = await req.json();
    const action = String(body?.action ?? "");
    const supabase = createServiceClient();

    if (action === "sign") {
      if (loaded.doc.docStatus === "signed" || loaded.doc.agreementStatus === "signed") {
        return NextResponse.json({ document: loaded.doc, alreadySigned: true });
      }
      if (loaded.doc.docStatus === "voided") {
        return NextResponse.json({ error: "This document has been voided" }, { status: 400 });
      }

      const signerName = String(body?.signerName ?? "").trim();
      const signerEmail = String(body?.signerEmail ?? "").trim();
      const signerCapacity = String(body?.signerCapacity ?? "").trim();

      if (!signerName) {
        return NextResponse.json({ error: "Please enter your full legal name to sign" }, { status: 400 });
      }

      const ip = clientIpFromRequest(req);
      const ua = userAgentFromRequest(req);
      const signedAtLabel = nowAuLabel();
      const auditHash = `SHA256:${crypto
        .createHash("sha256")
        .update(
          `${loaded.doc.agreementRef}:${loaded.doc.abn}:${signerName}:${signerEmail}:${signerCapacity}:${ip}:${Date.now()}`
        )
        .digest("hex")
        .slice(0, 16)}`;

      const signedByDisplay = signerCapacity ? `${signerName} (${signerCapacity})` : signerName;

      const { error: updErr } = await supabase
        .from("cobid_scopes")
        .update({
          agreement_status: "signed",
          doc_status: "signed",
          client_signed_at: signedAtLabel,
          client_signed_by: signedByDisplay,
          agreement_audit_hash: auditHash,
          client_signed_ip: ip,
          client_signed_user_agent: ua,
        })
        .eq("id", loaded.scopeId)
        .eq("org_id", loaded.orgId);

      if (updErr) throw new Error(updErr.message);

      await addCobidAuditEvent({
        orgId: loaded.orgId,
        workspaceId: loaded.workspaceId,
        actor: `${signedByDisplay} (Client)`,
        category: "legal",
        summary: `Executed independent agreement ${loaded.doc.agreementRef} (${loaded.doc.independentJobRef}) directly with ${loaded.doc.companyName} via docs.hazmatmanagement.com.au (${auditHash}).`,
        restrictedToScopeId: loaded.scopeId,
      });

      // Trigger *this OpCo's* Xero deposit invoice immediately (never throws)
      const xeroResult = await raiseOpCoXeroInvoice(loaded.scopeId, "deposit");

      const refreshed = await loadPublicDoc(req, token);
      return NextResponse.json({
        document: refreshed?.doc ?? loaded.doc,
        xeroResult,
      });
    }

    if (action === "decline") {
      if (loaded.doc.docStatus === "signed" || loaded.doc.agreementStatus === "signed") {
        return NextResponse.json({ error: "Already signed" }, { status: 400 });
      }
      const reason = String(body?.reason ?? "").trim() || "Declined by client";
      await supabase
        .from("cobid_scopes")
        .update({
          doc_status: "declined",
          doc_declined_at: new Date().toISOString(),
          doc_decline_reason: reason,
        })
        .eq("id", loaded.scopeId)
        .eq("org_id", loaded.orgId);

      await addCobidAuditEvent({
        orgId: loaded.orgId,
        workspaceId: loaded.workspaceId,
        actor: `${loaded.doc.clientName} (Client)`,
        category: "legal",
        summary: `Declined independent quote ${loaded.doc.independentJobRef} (${loaded.doc.companyName}): "${reason}".`,
        restrictedToScopeId: loaded.scopeId,
      });

      const refreshed = await loadPublicDoc(req, token);
      return NextResponse.json({ document: refreshed?.doc ?? loaded.doc });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error("POST /api/cobid/doc/[token] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to process document action" },
      { status: 500 }
    );
  }
}
