/*
 * lib/cobid/store.ts
 *
 * Supabase Postgres data layer for Co-Bid workspaces and the OpCo Directory.
 * Enforces org_id scoping on every query and server-side commercial ring-fencing
 * when a workspace is read by a Contractor OpCo.
 */
import { createServiceClient } from "@/lib/supabase";
import { DEFAULT_OPCO_TEMPLATES } from "./seed-defaults";
import { nowAuLabel, todayAuLabel } from "./utils";
import type {
  AuditEvent,
  ComplianceDoc,
  DirectoryOpCo,
  JobWorkspace,
  LineItem,
  Milestone,
  OpCoScope,
  ProgressLog,
  SettlementRail,
  UserRole,
  VariationOrder,
  WorkspaceMessage,
} from "./types";

interface DbOpCoRow {
  id: string;
  key: string;
  trade_category: string;
  company_name: string;
  abn: string;
  licence_number: string;
  monogram: string;
  contact_name: string;
  contact_email: string;
  bank_name: string;
  bsb: string;
  account_number: string;
  pay_id: string;
  default_deposit_pct: number;
  default_scope_summary: string;
  default_deliverables: string[] | null;
  default_exclusions: string[] | null;
  default_line_items: DirectoryOpCo["defaultLineItems"] | null;
  default_milestones: DirectoryOpCo["defaultMilestones"] | null;
  default_compliance_docs: string[] | null;
  is_active: boolean;
}

interface DbWorkspaceRow {
  id: string;
  org_id: string;
  reference: string;
  title: string;
  property_address: string;
  suburb_state: string;
  lead_source: string;
  lead_source_type: string;
  created_at_label: string;
  client_name: string;
  client_role: string;
  client_email: string;
  client_phone: string;
  settlement_rail: string;
  coordinator_name: string;
  site_access_notes: string;
}

interface DbScopeRow {
  id: string;
  workspace_id: string;
  sequence_order: number;
  depends_on_scope_id: string | null;
  trade_category: string;
  company_name: string;
  abn: string;
  licence_number: string;
  monogram: string;
  contact_name: string;
  contact_email: string;
  bank_name: string;
  bsb: string;
  account_number: string;
  pay_id: string;
  deposit_percent: number;
  scope_summary: string;
  scope_deliverables: string[] | null;
  exclusions: string[] | null;
  scope_status: string;
  revision_note: string | null;
  contractor_approved_at: string | null;
  agreement_ref: string;
  agreement_status: string;
  agreement_sent_at: string | null;
  client_signed_at: string | null;
  client_signed_by: string | null;
  agreement_audit_hash: string | null;
  deposit_status: string;
  deposit_paid_at: string | null;
  deposit_payment_ref: string | null;
  deposit_method: string | null;
  balance_status: string;
  balance_paid_at: string | null;
  balance_payment_ref: string | null;
  balance_invoice_ref: string;
  completion_signed_off: boolean;
  completion_signed_at: string | null;
  completion_notes: string | null;
}

function mapDirectoryRow(r: DbOpCoRow): DirectoryOpCo {
  return {
    id: r.id,
    key: r.key,
    tradeCategory: r.trade_category,
    companyName: r.company_name,
    abn: r.abn,
    licenceNumber: r.licence_number,
    monogram: r.monogram,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    bankName: r.bank_name,
    bsb: r.bsb,
    accountNumber: r.account_number,
    payId: r.pay_id,
    defaultDepositPercent: r.default_deposit_pct ?? 30,
    defaultScopeSummary: r.default_scope_summary ?? "",
    defaultDeliverables: Array.isArray(r.default_deliverables) ? r.default_deliverables : [],
    defaultExclusions: Array.isArray(r.default_exclusions) ? r.default_exclusions : [],
    defaultLineItems: Array.isArray(r.default_line_items) ? r.default_line_items : [],
    defaultMilestones: Array.isArray(r.default_milestones) ? r.default_milestones : [],
    defaultComplianceDocs: Array.isArray(r.default_compliance_docs) ? r.default_compliance_docs : [],
    isActive: r.is_active !== false,
  };
}

/** Seed starter OpCo Directory entries for an org if none exist yet. */
export async function ensureDirectorySeeded(orgId: string): Promise<void> {
  const supabase = createServiceClient();
  const { count } = await supabase
    .from("cobid_opcos")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);

  if ((count ?? 0) > 0) return;

  await supabase.from("cobid_opcos").insert(
    DEFAULT_OPCO_TEMPLATES.map((tpl) => ({
      org_id: orgId,
      key: tpl.key,
      trade_category: tpl.tradeCategory,
      company_name: tpl.companyName,
      abn: tpl.abn,
      licence_number: tpl.licenceNumber,
      monogram: tpl.monogram,
      contact_name: tpl.contactName,
      contact_email: tpl.contactEmail,
      bank_name: tpl.bankName,
      bsb: tpl.bsb,
      account_number: tpl.accountNumber,
      pay_id: tpl.payId,
      default_deposit_pct: tpl.defaultDepositPercent,
      default_scope_summary: tpl.defaultScopeSummary,
      default_deliverables: tpl.defaultDeliverables,
      default_exclusions: tpl.defaultExclusions,
      default_line_items: tpl.defaultLineItems,
      default_milestones: tpl.defaultMilestones,
      default_compliance_docs: tpl.defaultComplianceDocs,
    }))
  );
}

export async function listDirectoryOpCos(orgId: string): Promise<DirectoryOpCo[]> {
  await ensureDirectorySeeded(orgId);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("cobid_opcos")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data ?? []) as DbOpCoRow[]).map(mapDirectoryRow);
}

export async function upsertDirectoryOpCo(
  orgId: string,
  input: Partial<DirectoryOpCo> & { companyName: string; tradeCategory: string }
): Promise<DirectoryOpCo> {
  const supabase = createServiceClient();
  const key =
    (input.key || input.companyName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || `opco-${Date.now()}`;

  const monogram =
    (input.monogram ||
      input.companyName
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2) ||
      "OP"
    ).toUpperCase();

  const row = {
    org_id: orgId,
    key,
    trade_category: input.tradeCategory.trim(),
    company_name: input.companyName.trim(),
    abn: (input.abn ?? "").trim(),
    licence_number: (input.licenceNumber ?? "").trim(),
    monogram,
    contact_name: (input.contactName ?? "").trim(),
    contact_email: (input.contactEmail ?? "").trim(),
    bank_name: (input.bankName ?? "").trim(),
    bsb: (input.bsb ?? "").trim(),
    account_number: (input.accountNumber ?? "").trim(),
    pay_id: (input.payId ?? "").trim(),
    default_deposit_pct: Number(input.defaultDepositPercent) || 30,
    default_scope_summary: (input.defaultScopeSummary ?? "").trim(),
    default_deliverables: input.defaultDeliverables ?? [],
    default_exclusions: input.defaultExclusions ?? [],
    default_line_items: input.defaultLineItems ?? [],
    default_milestones: input.defaultMilestones ?? [],
    default_compliance_docs: input.defaultComplianceDocs ?? [],
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("cobid_opcos")
      .update(row)
      .eq("id", input.id)
      .eq("org_id", orgId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapDirectoryRow(data as DbOpCoRow);
  }

  const { data, error } = await supabase
    .from("cobid_opcos")
    .upsert(row, { onConflict: "org_id,key" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapDirectoryRow(data as DbOpCoRow);
}

export async function archiveDirectoryOpCo(orgId: string, id: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("cobid_opcos")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);
}

async function hydrateWorkspaces(
  orgId: string,
  workspaces: DbWorkspaceRow[],
  role?: UserRole
): Promise<JobWorkspace[]> {
  if (workspaces.length === 0) return [];
  const supabase = createServiceClient();
  const wsIds = workspaces.map((w) => w.id);

  const [scopesRes, auditRes, msgRes] = await Promise.all([
    supabase
      .from("cobid_scopes")
      .select("*")
      .eq("org_id", orgId)
      .in("workspace_id", wsIds)
      .order("sequence_order", { ascending: true }),
    supabase
      .from("cobid_audit_events")
      .select("*")
      .eq("org_id", orgId)
      .in("workspace_id", wsIds)
      .order("inserted_at", { ascending: false }),
    supabase
      .from("cobid_messages")
      .select("*")
      .eq("org_id", orgId)
      .in("workspace_id", wsIds)
      .order("inserted_at", { ascending: true }),
  ]);

  if (scopesRes.error) throw new Error(scopesRes.error.message);
  if (auditRes.error) throw new Error(auditRes.error.message);
  if (msgRes.error) throw new Error(msgRes.error.message);

  const scopes = (scopesRes.data ?? []) as DbScopeRow[];
  const scopeIds = scopes.map((s) => s.id);

  const [liRes, varRes, msRes, logRes, docRes] =
    scopeIds.length > 0
      ? await Promise.all([
          supabase
            .from("cobid_line_items")
            .select("*")
            .eq("org_id", orgId)
            .in("scope_id", scopeIds)
            .order("sort_order", { ascending: true }),
          supabase
            .from("cobid_variations")
            .select("*")
            .eq("org_id", orgId)
            .in("scope_id", scopeIds)
            .order("inserted_at", { ascending: false }),
          supabase
            .from("cobid_milestones")
            .select("*")
            .eq("org_id", orgId)
            .in("scope_id", scopeIds)
            .order("sort_order", { ascending: true }),
          supabase
            .from("cobid_progress_logs")
            .select("*")
            .eq("org_id", orgId)
            .in("scope_id", scopeIds)
            .order("inserted_at", { ascending: false }),
          supabase
            .from("cobid_compliance_docs")
            .select("*")
            .eq("org_id", orgId)
            .in("scope_id", scopeIds),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const isContractor = role?.type === "contractor";
  const viewerOpCoId = isContractor ? role.opCoId : null;

  const lineItemsByScope = new Map<string, LineItem[]>();
  for (const r of (liRes.data ?? []) as Array<Record<string, unknown>>) {
    const sid = String(r.scope_id);
    const arr = lineItemsByScope.get(sid) ?? [];
    arr.push({
      id: String(r.id),
      code: String(r.code),
      description: String(r.description),
      unit: String(r.unit),
      qty: Number(r.qty),
      unitPrice: Number(r.unit_price),
      category: String(r.category),
    });
    lineItemsByScope.set(sid, arr);
  }

  const varsByScope = new Map<string, VariationOrder[]>();
  for (const r of (varRes.data ?? []) as Array<Record<string, unknown>>) {
    const sid = String(r.scope_id);
    const arr = varsByScope.get(sid) ?? [];
    arr.push({
      id: String(r.id),
      reference: String(r.reference),
      title: String(r.title),
      reason: String(r.reason),
      amountExGst: Number(r.amount_ex_gst),
      status: String(r.status) as VariationOrder["status"],
      createdAt: String(r.created_at_label),
      createdBy: String(r.created_by),
      approvedAt: r.approved_at ? String(r.approved_at) : undefined,
      approvedBy: r.approved_by ? String(r.approved_by) : undefined,
    });
    varsByScope.set(sid, arr);
  }

  const milestonesByScope = new Map<string, Milestone[]>();
  for (const r of (msRes.data ?? []) as Array<Record<string, unknown>>) {
    const sid = String(r.scope_id);
    const arr = milestonesByScope.get(sid) ?? [];
    arr.push({
      id: String(r.id),
      title: String(r.title),
      description: String(r.description),
      targetDay: String(r.target_day),
      status: String(r.status) as Milestone["status"],
      completedAt: r.completed_at ? String(r.completed_at) : undefined,
      isHandoverGate: Boolean(r.is_handover_gate),
    });
    milestonesByScope.set(sid, arr);
  }

  const logsByScope = new Map<string, ProgressLog[]>();
  for (const r of (logRes.data ?? []) as Array<Record<string, unknown>>) {
    const sid = String(r.scope_id);
    const arr = logsByScope.get(sid) ?? [];
    arr.push({
      id: String(r.id),
      timestamp: String(r.timestamp_label),
      author: String(r.author),
      summary: String(r.summary),
      stage: String(r.stage) as ProgressLog["stage"],
      photoLabel: r.photo_label ? String(r.photo_label) : undefined,
      photoTone: r.photo_tone ? String(r.photo_tone) : undefined,
      photoUrl: r.photo_url ? String(r.photo_url) : undefined,
    });
    logsByScope.set(sid, arr);
  }

  const docsByScope = new Map<string, ComplianceDoc[]>();
  for (const r of (docRes.data ?? []) as Array<Record<string, unknown>>) {
    const sid = String(r.scope_id);
    const arr = docsByScope.get(sid) ?? [];
    arr.push({
      id: String(r.id),
      title: String(r.title),
      reference: String(r.reference),
      issuedAt: String(r.issued_at),
      status: String(r.status) as ComplianceDoc["status"],
      fileUrl: r.file_url ? String(r.file_url) : undefined,
    });
    docsByScope.set(sid, arr);
  }

  const scopesByWs = new Map<string, OpCoScope[]>();
  for (const o of scopes) {
    const isRingFencedOther = isContractor && viewerOpCoId !== o.id;
    const mapped: OpCoScope = {
      id: o.id,
      sequenceOrder: o.sequence_order,
      dependsOnOpCoId: o.depends_on_scope_id ?? undefined,
      tradeCategory: o.trade_category,
      companyName: o.company_name,
      abn: o.abn,
      licenceNumber: o.licence_number,
      monogram: o.monogram,
      contactName: o.contact_name,
      contactEmail: o.contact_email,
      bankName: isRingFencedOther ? "Redacted" : o.bank_name,
      bsb: isRingFencedOther ? "•••-•••" : o.bsb,
      accountNumber: isRingFencedOther ? "••••••••" : o.account_number,
      payId: isRingFencedOther ? "Redacted" : o.pay_id,
      depositPercent: o.deposit_percent,
      scopeSummary: isRingFencedOther
        ? "Independent trade scope (ring-fenced)."
        : o.scope_summary,
      scopeDeliverables: isRingFencedOther
        ? []
        : Array.isArray(o.scope_deliverables)
          ? o.scope_deliverables
          : [],
      exclusions: isRingFencedOther
        ? []
        : Array.isArray(o.exclusions)
          ? o.exclusions
          : [],
      lineItems: isRingFencedOther ? [] : lineItemsByScope.get(o.id) ?? [],
      scopeStatus: o.scope_status as OpCoScope["scopeStatus"],
      revisionNote: isRingFencedOther ? undefined : o.revision_note ?? undefined,
      contractorApprovedAt: o.contractor_approved_at ?? undefined,
      agreementRef: o.agreement_ref,
      agreementStatus: o.agreement_status as OpCoScope["agreementStatus"],
      agreementSentAt: o.agreement_sent_at ?? undefined,
      clientSignedAt: o.client_signed_at ?? undefined,
      clientSignedBy: o.client_signed_by ?? undefined,
      agreementAuditHash: isRingFencedOther ? undefined : o.agreement_audit_hash ?? undefined,
      depositStatus: o.deposit_status as OpCoScope["depositStatus"],
      depositPaidAt: o.deposit_paid_at ?? undefined,
      depositPaymentRef: isRingFencedOther ? undefined : o.deposit_payment_ref ?? undefined,
      depositMethod: isRingFencedOther
        ? undefined
        : (o.deposit_method as OpCoScope["depositMethod"]),
      balanceStatus: o.balance_status as OpCoScope["balanceStatus"],
      balancePaidAt: o.balance_paid_at ?? undefined,
      balancePaymentRef: isRingFencedOther ? undefined : o.balance_payment_ref ?? undefined,
      balanceInvoiceRef: o.balance_invoice_ref,
      variations: isRingFencedOther ? [] : varsByScope.get(o.id) ?? [],
      milestones: milestonesByScope.get(o.id) ?? [],
      progressLogs: logsByScope.get(o.id) ?? [],
      completionSignedOff: Boolean(o.completion_signed_off),
      completionSignedAt: o.completion_signed_at ?? undefined,
      completionNotes: o.completion_notes ?? undefined,
      complianceDocs: (docsByScope.get(o.id) ?? []).map((d) => ({
        ...d,
        fileUrl: isRingFencedOther ? undefined : d.fileUrl,
      })),
    };
    const arr = scopesByWs.get(o.workspace_id) ?? [];
    arr.push(mapped);
    scopesByWs.set(o.workspace_id, arr);
  }

  const auditByWs = new Map<string, AuditEvent[]>();
  for (const r of (auditRes.data ?? []) as Array<Record<string, unknown>>) {
    const restricted = r.restricted_to_scope_id ? String(r.restricted_to_scope_id) : undefined;
    if (isContractor && restricted && restricted !== viewerOpCoId) continue;
    const wid = String(r.workspace_id);
    const arr = auditByWs.get(wid) ?? [];
    arr.push({
      id: String(r.id),
      timestamp: String(r.timestamp_label),
      actor: String(r.actor),
      category: String(r.category) as AuditEvent["category"],
      summary: String(r.summary),
      restrictedToOpCoId: restricted,
    });
    auditByWs.set(wid, arr);
  }

  const msgsByWs = new Map<string, WorkspaceMessage[]>();
  for (const r of (msgRes.data ?? []) as Array<Record<string, unknown>>) {
    const channel = String(r.channel);
    if (isContractor && channel !== "shared_ops" && channel !== viewerOpCoId) continue;
    const wid = String(r.workspace_id);
    const arr = msgsByWs.get(wid) ?? [];
    arr.push({
      id: String(r.id),
      channel,
      timestamp: String(r.timestamp_label),
      senderName: String(r.sender_name),
      senderRoleLabel: String(r.sender_role_label),
      body: String(r.body),
    });
    msgsByWs.set(wid, arr);
  }

  return workspaces.map((job) => ({
    id: job.id,
    reference: job.reference,
    title: job.title,
    propertyAddress: job.property_address,
    suburbState: job.suburb_state,
    leadSource: job.lead_source,
    leadSourceType: job.lead_source_type as JobWorkspace["leadSourceType"],
    createdAt: job.created_at_label,
    clientName: job.client_name,
    clientRole: job.client_role,
    clientEmail: job.client_email,
    clientPhone: job.client_phone,
    settlementRail: job.settlement_rail as SettlementRail,
    coordinatorName: job.coordinator_name,
    siteAccessNotes: job.site_access_notes,
    opCos: scopesByWs.get(job.id) ?? [],
    auditLog: auditByWs.get(job.id) ?? [],
    messages: msgsByWs.get(job.id) ?? [],
  }));
}

export async function listWorkspaces(
  orgId: string,
  opts?: { workspaceId?: string; role?: UserRole }
): Promise<JobWorkspace[]> {
  const supabase = createServiceClient();
  let query = supabase
    .from("cobid_workspaces")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (opts?.workspaceId) {
    query = query.eq("id", opts.workspaceId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return hydrateWorkspaces(orgId, (data ?? []) as DbWorkspaceRow[], opts?.role);
}

export async function getWorkspaceById(
  orgId: string,
  workspaceId: string,
  role?: UserRole
): Promise<JobWorkspace | null> {
  const rows = await listWorkspaces(orgId, { workspaceId, role });
  return rows[0] ?? null;
}

export interface CreateWorkspaceInput {
  title?: string;
  propertyAddress: string;
  suburbState?: string;
  clientName: string;
  clientRole?: string;
  clientEmail?: string;
  clientPhone?: string;
  leadSource?: string;
  leadSourceType?: JobWorkspace["leadSourceType"];
  settlementRail?: SettlementRail;
  siteAccessNotes?: string;
  coordinatorName: string;
  selectedOpCoKeys: string[];
}

export async function createWorkspace(
  orgId: string,
  input: CreateWorkspaceInput
): Promise<JobWorkspace> {
  const directory = await listDirectoryOpCos(orgId);
  const templates = input.selectedOpCoKeys
    .map((k) => directory.find((t) => t.key === k || t.id === k))
    .filter((t): t is DirectoryOpCo => Boolean(t));

  if (templates.length === 0) {
    throw new Error("No valid OpCos selected");
  }

  const supabase = createServiceClient();
  const num = Math.floor(1000 + Math.random() * 8999);
  const ref = `CB-${new Date().getFullYear()}-${num}`;

  const { data: wsData, error: wsErr } = await supabase
    .from("cobid_workspaces")
    .insert({
      org_id: orgId,
      reference: ref,
      title:
        input.title?.trim() ||
        templates.map((t) => t.tradeCategory.split(" ")[0]).join(" + "),
      property_address: input.propertyAddress.trim(),
      suburb_state: input.suburbState?.trim() || "Brisbane QLD 4000",
      lead_source: input.leadSource?.trim() || "Direct Intake",
      lead_source_type: input.leadSourceType || "Direct Client",
      created_at_label: todayAuLabel(),
      client_name: input.clientName.trim(),
      client_role: input.clientRole?.trim() || "Property Owner",
      client_email: input.clientEmail?.trim() || "",
      client_phone: input.clientPhone?.trim() || "",
      settlement_rail: input.settlementRail || "direct_to_opco",
      coordinator_name: input.coordinatorName,
      site_access_notes:
        input.siteAccessNotes?.trim() || "Access details to be confirmed prior to mobilisation.",
    })
    .select("*")
    .single();

  if (wsErr || !wsData) throw new Error(wsErr?.message || "Failed to create workspace");
  const workspaceId = (wsData as DbWorkspaceRow).id;

  let prevScopeId: string | null = null;

  for (let idx = 0; idx < templates.length; idx++) {
    const tpl = templates[idx];
    const scopeRes: { data: { id: string } | null; error: { message: string } | null } =
      await supabase
        .from("cobid_scopes")
        .insert({
          workspace_id: workspaceId,
          org_id: orgId,
          directory_opco_id: tpl.id,
          sequence_order: idx + 1,
          depends_on_scope_id: prevScopeId,
          trade_category: tpl.tradeCategory,
          company_name: tpl.companyName,
          abn: tpl.abn,
          licence_number: tpl.licenceNumber,
          monogram: tpl.monogram,
          contact_name: tpl.contactName,
          contact_email: tpl.contactEmail,
          bank_name: tpl.bankName,
          bsb: tpl.bsb,
          account_number: tpl.accountNumber,
          pay_id: tpl.payId,
          deposit_percent: tpl.defaultDepositPercent || 30,
          scope_summary: tpl.defaultScopeSummary,
          scope_deliverables: tpl.defaultDeliverables,
          exclusions: tpl.defaultExclusions,
          scope_status: "draft",
          agreement_ref: `AGR-${num}-${tpl.monogram}0${idx + 1}`,
          agreement_status: "not_ready",
          deposit_status: "pending",
          balance_status: "pending",
          balance_invoice_ref: `INV-${num}-${tpl.monogram}0${idx + 1}`,
        })
        .select("id")
        .single();

    if (scopeRes.error || !scopeRes.data) {
      throw new Error(scopeRes.error?.message || "Failed to create OpCo scope");
    }

    const scopeId = String(scopeRes.data.id);
    prevScopeId = scopeId;

    if (tpl.defaultLineItems.length > 0) {
      await supabase.from("cobid_line_items").insert(
        tpl.defaultLineItems.map((li, i) => ({
          scope_id: scopeId,
          org_id: orgId,
          code: li.code,
          description: li.description,
          unit: li.unit,
          qty: li.qty,
          unit_price: li.unitPrice,
          category: li.category,
          sort_order: i,
        }))
      );
    }

    if (tpl.defaultMilestones.length > 0) {
      await supabase.from("cobid_milestones").insert(
        tpl.defaultMilestones.map((m, i) => ({
          scope_id: scopeId,
          org_id: orgId,
          title: m.title,
          description: m.description,
          target_day: m.targetDay,
          is_handover_gate: Boolean(m.isHandoverGate),
          status: idx === 0 ? "pending" : "locked",
          sort_order: i,
        }))
      );
    }

    if (tpl.defaultComplianceDocs.length > 0) {
      await supabase.from("cobid_compliance_docs").insert(
        tpl.defaultComplianceDocs.map((title) => ({
          scope_id: scopeId,
          org_id: orgId,
          title,
          reference: "Pending completion",
          issued_at: "—",
          status: "pending",
        }))
      );
    }
  }

  await supabase.from("cobid_audit_events").insert({
    workspace_id: workspaceId,
    org_id: orgId,
    timestamp_label: nowAuLabel(),
    actor: input.coordinatorName,
    category: "workspace",
    summary: `Created Co-Bid Workspace ${ref} with ${templates.length} independent OpCos (${input.leadSourceType || "Direct Client"}).`,
  });

  await supabase.from("cobid_messages").insert({
    workspace_id: workspaceId,
    org_id: orgId,
    channel: "shared_ops",
    timestamp_label: nowAuLabel(),
    sender_name: input.coordinatorName,
    sender_role_label: "Scoping Desk",
    body: `Workspace ${ref} initialised for ${input.propertyAddress}. Scopes are being drafted for each independent OpCo.`,
  });

  const created = await getWorkspaceById(orgId, workspaceId);
  if (!created) throw new Error("Workspace created but could not be reloaded");
  return created;
}

export async function addCobidAuditEvent(params: {
  orgId: string;
  workspaceId: string;
  actor: string;
  category: AuditEvent["category"];
  summary: string;
  restrictedToScopeId?: string | null;
}): Promise<void> {
  const supabase = createServiceClient();
  await supabase.from("cobid_audit_events").insert({
    org_id: params.orgId,
    workspace_id: params.workspaceId,
    timestamp_label: nowAuLabel(),
    actor: params.actor,
    category: params.category,
    summary: params.summary,
    restricted_to_scope_id: params.restrictedToScopeId ?? null,
  });
}
