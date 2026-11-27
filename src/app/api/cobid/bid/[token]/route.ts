import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { addCobidAuditEvent } from "@/lib/cobid/store";
import { nowAuLabel } from "@/lib/cobid/utils";
import type { LineItem, Milestone, QuoteType, StructuredQuoteData } from "@/lib/cobid/types";

async function loadBidPayload(token: string) {
  const supabase = createServiceClient();
  const { data: scopeRow, error } = await supabase
    .from("cobid_scopes")
    .select("*")
    .eq("bid_token", token)
    .maybeSingle();

  if (error || !scopeRow) return null;

  const expired =
    Boolean(scopeRow.bid_token_expires_at) &&
    new Date(String(scopeRow.bid_token_expires_at)).getTime() < Date.now() &&
    scopeRow.scope_status !== "contractor_approved";

  const [wsRes, liRes, msRes, countRes, opcoRes] = await Promise.all([
    supabase
      .from("cobid_workspaces")
      .select(
        "id, org_id, linked_job_id, shared_photo_ids, reference, title, property_address, suburb_state, client_name, client_role, site_access_notes, coordinator_name"
      )
      .eq("id", scopeRow.workspace_id)
      .single(),
    supabase
      .from("cobid_line_items")
      .select("*")
      .eq("scope_id", scopeRow.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("cobid_milestones")
      .select("*")
      .eq("scope_id", scopeRow.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("cobid_scopes")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", scopeRow.workspace_id),
    scopeRow.directory_opco_id
      ? supabase
          .from("cobid_opcos")
          .select("gst_registered, terms_and_conditions, legal_entity_name, trading_name")
          .eq("id", scopeRow.directory_opco_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (wsRes.error || !wsRes.data) return null;
  const ws = wsRes.data as Record<string, unknown>;

  let sharedPhotos: Array<{ id: string; url: string; caption?: string; category?: string }> = [];
  const photoIds = Array.isArray(ws.shared_photo_ids)
    ? (ws.shared_photo_ids as string[]).filter((x) => typeof x === "string")
    : [];
  if (ws.linked_job_id && photoIds.length > 0) {
    const { data: photosData } = await supabase
      .from("photos")
      .select("id, url, caption, category")
      .eq("job_id", String(ws.linked_job_id))
      .in("id", photoIds);
    sharedPhotos = ((photosData ?? []) as Array<Record<string, unknown>>).map((p) => ({
      id: String(p.id),
      url: String(p.url || ""),
      caption: p.caption ? String(p.caption) : undefined,
      category: p.category ? String(p.category) : undefined,
    }));
  }

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

  const milestones: Milestone[] = ((msRes.data ?? []) as Array<Record<string, unknown>>).map(
    (r) => ({
      id: String(r.id),
      title: String(r.title),
      description: String(r.description),
      targetDay: String(r.target_day),
      status: String(r.status) as Milestone["status"],
      completedAt: r.completed_at ? String(r.completed_at) : undefined,
      isHandoverGate: Boolean(r.is_handover_gate),
    })
  );

  return {
    expired,
    orgId: String(scopeRow.org_id),
    workspaceId: String(scopeRow.workspace_id),
    site: {
      reference: String(ws.reference),
      title: String(ws.title),
      propertyAddress: String(ws.property_address),
      suburbState: String(ws.suburb_state || ""),
      clientName: String(ws.client_name),
      clientRole: String(ws.client_role || ""),
      siteAccessNotes: String(ws.site_access_notes || ""),
      coordinatorName: String(ws.coordinator_name || ""),
      totalStages: countRes.count ?? 1,
    },
    sharedPhotos,
    scope: {
      id: String(scopeRow.id),
      sequenceOrder: Number(scopeRow.sequence_order),
      tradeCategory: String(scopeRow.trade_category),
      quoteType: (String(scopeRow.quote_type || "custom") as QuoteType),
      independentJobRef: String(scopeRow.independent_job_ref || scopeRow.agreement_ref),
      structuredQuoteData: (scopeRow.structured_quote_data || {}) as StructuredQuoteData,
      companyName: String(scopeRow.company_name),
      legalEntityName: opcoRes.data?.legal_entity_name || String(scopeRow.company_name),
      gstRegistered: opcoRes.data?.gst_registered !== false,
      abn: String(scopeRow.abn || ""),
      licenceNumber: String(scopeRow.licence_number || ""),
      monogram: String(scopeRow.monogram || "OP"),
      contactName: String(scopeRow.contact_name || ""),
      contactEmail: String(scopeRow.contact_email || ""),
      depositPercent: Number(scopeRow.deposit_percent ?? 30),
      scopeSummary: String(scopeRow.scope_summary || ""),
      scopeDeliverables: Array.isArray(scopeRow.scope_deliverables)
        ? (scopeRow.scope_deliverables as string[])
        : [],
      exclusions: Array.isArray(scopeRow.exclusions)
        ? (scopeRow.exclusions as string[])
        : [],
      scopeStatus: String(scopeRow.scope_status),
      contractorApprovedAt: scopeRow.contractor_approved_at
        ? String(scopeRow.contractor_approved_at)
        : null,
      agreementRef: String(scopeRow.agreement_ref),
      agreementStatus: String(scopeRow.agreement_status),
      lineItems,
      milestones,
    },
  };
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const data = await loadBidPayload(token);
    if (!data) {
      return NextResponse.json({ error: "Quote builder invite not found" }, { status: 404 });
    }
    if (data.expired) {
      return NextResponse.json(
        { error: "This quote builder invite has expired. Request a new link from the Coordinator." },
        { status: 410 }
      );
    }
    return NextResponse.json({
      site: data.site,
      sharedPhotos: data.sharedPhotos,
      scope: data.scope,
    });
  } catch (err) {
    console.error("GET /api/cobid/bid/[token] error:", err);
    return NextResponse.json({ error: "Failed to load quote builder" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const data = await loadBidPayload(token);
    if (!data) {
      return NextResponse.json({ error: "Quote builder invite not found" }, { status: 404 });
    }
    if (data.expired) {
      return NextResponse.json({ error: "Quote builder invite expired" }, { status: 410 });
    }
    if (data.scope.agreementStatus === "signed") {
      return NextResponse.json(
        { error: "This quote has already been executed by the client and cannot be edited." },
        { status: 400 }
      );
    }

    const body = await req.json();
    const supabase = createServiceClient();
    const update: Record<string, unknown> = {};

    if (typeof body.scopeSummary === "string") update.scope_summary = body.scopeSummary.trim();
    if (typeof body.independentJobRef === "string" && body.independentJobRef.trim()) {
      update.independent_job_ref = body.independentJobRef.trim();
    }
    if (typeof body.depositPercent === "number" && Number.isFinite(body.depositPercent)) {
      update.deposit_percent = Math.max(0, Math.min(100, Math.round(body.depositPercent)));
    }
    if (Array.isArray(body.scopeDeliverables)) {
      update.scope_deliverables = body.scopeDeliverables
        .filter((s: unknown): s is string => typeof s === "string")
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    if (Array.isArray(body.exclusions)) {
      update.exclusions = body.exclusions
        .filter((s: unknown): s is string => typeof s === "string")
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    if (body.structuredQuoteData && typeof body.structuredQuoteData === "object") {
      update.structured_quote_data = body.structuredQuoteData;
    }

    if (data.scope.scopeStatus === "draft" || data.scope.scopeStatus === "revision_requested") {
      update.scope_status = "pending_contractor";
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from("cobid_scopes")
        .update(update)
        .eq("id", data.scope.id)
        .eq("org_id", data.orgId);
      if (error) throw new Error(error.message);
    }

    if (Array.isArray(body.lineItems)) {
      await supabase
        .from("cobid_line_items")
        .delete()
        .eq("scope_id", data.scope.id)
        .eq("org_id", data.orgId);

      const items = (body.lineItems as Array<Record<string, unknown>>)
        .filter((li) => String(li.description || "").trim().length > 0)
        .map((li, idx) => ({
          scope_id: data.scope.id,
          org_id: data.orgId,
          code: String(li.code || `LI-${idx + 1}`).trim(),
          description: String(li.description || "").trim(),
          unit: String(li.unit || "Allow").trim(),
          qty: Math.max(0.01, Number(li.qty) || 1),
          unit_price: Math.max(0, Number(li.unitPrice) || 0),
          category: String(li.category || "Scope").trim(),
          sort_order: idx,
        }));

      if (items.length > 0) {
        const { error: liErr } = await supabase.from("cobid_line_items").insert(items);
        if (liErr) throw new Error(liErr.message);
      }
    }

    if (Array.isArray(body.milestones)) {
      await supabase
        .from("cobid_milestones")
        .delete()
        .eq("scope_id", data.scope.id)
        .eq("org_id", data.orgId);

      const ms = (body.milestones as Array<Record<string, unknown>>)
        .filter((m) => String(m.title || "").trim().length > 0)
        .map((m, idx) => ({
          scope_id: data.scope.id,
          org_id: data.orgId,
          title: String(m.title || "").trim(),
          description: String(m.description || "").trim(),
          target_day: String(m.targetDay || `Day ${idx + 1}`).trim(),
          is_handover_gate: Boolean(m.isHandoverGate),
          status: data.scope.sequenceOrder === 1 ? "pending" : "locked",
          sort_order: idx,
        }));

      if (ms.length > 0) {
        const { error: msErr } = await supabase.from("cobid_milestones").insert(ms);
        if (msErr) throw new Error(msErr.message);
      }
    }

    const reloaded = await loadBidPayload(token);
    return NextResponse.json({
      site: reloaded?.site,
      sharedPhotos: reloaded?.sharedPhotos,
      scope: reloaded?.scope,
    });
  } catch (err) {
    console.error("PATCH /api/cobid/bid/[token] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save quote draft" },
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
    const data = await loadBidPayload(token);
    if (!data) {
      return NextResponse.json({ error: "Quote builder invite not found" }, { status: 404 });
    }
    if (data.expired) {
      return NextResponse.json({ error: "Quote builder invite expired" }, { status: 410 });
    }

    const body = await req.json();
    const action = String(body?.action ?? "");
    const supabase = createServiceClient();

    if (action === "approve_quote") {
      if (data.scope.lineItems.length === 0) {
        return NextResponse.json(
          { error: "Add at least one priced line item before locking your independent quote." },
          { status: 400 }
        );
      }

      const now = nowAuLabel();
      const { error } = await supabase
        .from("cobid_scopes")
        .update({
          scope_status: "contractor_approved",
          contractor_approved_at: now,
          revision_note: null,
          agreement_status:
            data.scope.agreementStatus === "not_ready"
              ? "ready_to_send"
              : data.scope.agreementStatus,
        })
        .eq("id", data.scope.id)
        .eq("org_id", data.orgId);

      if (error) throw new Error(error.message);

      await addCobidAuditEvent({
        orgId: data.orgId,
        workspaceId: data.workspaceId,
        actor: `${data.scope.contactName || data.scope.companyName} (${data.scope.companyName})`,
        category: "scope",
        summary: `Locked & approved independent ${data.scope.quoteType.toUpperCase()} quote (${data.scope.independentJobRef}) via OpCo Quote Builder.`,
        restrictedToScopeId: data.scope.id,
      });

      const reloaded = await loadBidPayload(token);
      return NextResponse.json({
        site: reloaded?.site,
        sharedPhotos: reloaded?.sharedPhotos,
        scope: reloaded?.scope,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error("POST /api/cobid/bid/[token] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed" },
      { status: 500 }
    );
  }
}
