import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { hashCobidToken } from "@/lib/cobid/store";
import { buildCobidDocUrl } from "@/lib/cobid/hosts";
import { calcTotals } from "@/lib/cobid/utils";
import { QUOTE_TYPE_META, type LineItem, type QuoteType } from "@/lib/cobid/types";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    if (!token || token.length < 16) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }

    const supabase = createServiceClient();
    const hash = hashCobidToken(token);

    const { data: ws } = await supabase
      .from("cobid_workspaces")
      .select(
        "id, org_id, reference, title, property_address, suburb_state, client_name, package_sent_at"
      )
      .eq("package_token_hash", hash)
      .maybeSingle();

    if (!ws) {
      return NextResponse.json({ error: "Coordinated dispatch index not found" }, { status: 404 });
    }

    const { data: scopes } = await supabase
      .from("cobid_scopes")
      .select(
        "id, directory_opco_id, sequence_order, trade_category, quote_type, independent_job_ref, company_name, abn, licence_number, monogram, deposit_percent, agreement_ref, agreement_status, doc_token, doc_status, client_signed_at, client_signed_by, deposit_status, xero_deposit_online_url"
      )
      .eq("workspace_id", ws.id)
      .eq("org_id", ws.org_id)
      .order("sequence_order", { ascending: true });

    const scopeRows = (scopes ?? []) as Array<Record<string, unknown>>;
    const scopeIds = scopeRows.map((s) => String(s.id));
    const dirIds = scopeRows
      .map((s) => (s.directory_opco_id ? String(s.directory_opco_id) : null))
      .filter((x): x is string => Boolean(x));

    const [liRes, opcoRes] = await Promise.all([
      scopeIds.length > 0
        ? supabase.from("cobid_line_items").select("*").in("scope_id", scopeIds)
        : Promise.resolve({ data: [] }),
      dirIds.length > 0
        ? supabase.from("cobid_opcos").select("id, gst_registered").in("id", dirIds)
        : Promise.resolve({ data: [] }),
    ]);

    const itemsByScope = new Map<string, LineItem[]>();
    for (const r of (liRes.data ?? []) as Array<Record<string, unknown>>) {
      const sid = String(r.scope_id);
      const arr = itemsByScope.get(sid) ?? [];
      arr.push({
        id: String(r.id),
        code: String(r.code),
        description: String(r.description),
        unit: String(r.unit),
        qty: Number(r.qty),
        unitPrice: Number(r.unit_price),
        category: String(r.category),
      });
      itemsByScope.set(sid, arr);
    }

    const gstMap = new Map<string, boolean>();
    for (const o of (opcoRes.data ?? []) as Array<Record<string, unknown>>) {
      gstMap.set(String(o.id), o.gst_registered !== false);
    }

    const entities = scopeRows.map((s) => {
      const sid = String(s.id);
      const li = itemsByScope.get(sid) ?? [];
      const depositPercent = Number(s.deposit_percent ?? 30);
      const totals = calcTotals(li, depositPercent);
      const dirId = s.directory_opco_id ? String(s.directory_opco_id) : "";
      const gstRegistered = dirId ? (gstMap.get(dirId) ?? true) : true;
      const totalIncGst = gstRegistered ? totals.baseSubtotal * 1.1 : totals.baseSubtotal;
      const depositAmount = totalIncGst * (depositPercent / 100);
      const qt = (String(s.quote_type || "custom") as QuoteType);
      const qtMeta = QUOTE_TYPE_META[qt] ?? QUOTE_TYPE_META.custom;
      const rawDocToken = s.doc_token ? String(s.doc_token) : null;

      return {
        scopeId: sid,
        stageOrder: Number(s.sequence_order),
        companyName: String(s.company_name),
        abn: String(s.abn || ""),
        licenceNumber: String(s.licence_number || ""),
        monogram: String(s.monogram || "OP"),
        tradeCategory: String(s.trade_category),
        quoteType: qt,
        quoteTypeCode: qtMeta.code,
        quoteTypeLabel: qtMeta.label,
        independentJobRef: String(s.independent_job_ref || s.agreement_ref),
        agreementRef: String(s.agreement_ref),
        totalIncGst,
        depositPercent,
        depositAmount,
        docStatus: String(s.doc_status || "not_sent"),
        agreementStatus: String(s.agreement_status || "not_ready"),
        depositStatus: String(s.deposit_status || "pending"),
        clientSignedAt: s.client_signed_at ? String(s.client_signed_at) : null,
        clientSignedBy: s.client_signed_by ? String(s.client_signed_by) : null,
        docUrl: rawDocToken ? buildCobidDocUrl(req, rawDocToken) : null,
        xeroDepositOnlineUrl: s.xero_deposit_online_url
          ? String(s.xero_deposit_online_url)
          : null,
      };
    });

    return NextResponse.json({
      package: {
        reference: String(ws.reference),
        title: String(ws.title),
        propertyAddress: String(ws.property_address),
        suburbState: String(ws.suburb_state || ""),
        clientName: String(ws.client_name),
        sentAt: ws.package_sent_at ? String(ws.package_sent_at) : null,
        entities,
      },
    });
  } catch (err) {
    console.error("GET /api/cobid/pkg/[token] error:", err);
    return NextResponse.json({ error: "Failed to load dispatch index" }, { status: 500 });
  }
}
