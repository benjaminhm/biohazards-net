/*
 * lib/cobid/store.ts
 *
 * Supabase Postgres data layer for Co-Bid workspaces, the gated OpCo Directory,
 * compliance vault, Xero status hydration, and independent entity documents.
 * Enforces org_id scoping on every query and server-side commercial ring-fencing
 * when a workspace is read by a Contractor OpCo.
 */
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase";
import { DEFAULT_OPCO_TEMPLATES } from "./seed-defaults";
import { buildCobidBidUrl, buildCobidDocUrl, buildCobidPackageUrl } from "./hosts";
import { generateCobidToken } from "./session";
import { nowAuLabel, todayAuLabel } from "./utils";
import {
  QUOTE_TYPE_META,
  type AuditEvent,
  type ComplianceDoc,
  type DirectoryOpCo,
  type JobWorkspace,
  type LineItem,
  type Milestone,
  type OnboardingStatus,
  type OpCoComplianceDoc,
  type OpCoComplianceDocType,
  type OpCoScope,
  type OpCoXeroSummary,
  type ProgressLog,
  type QuoteType,
  type SettlementRail,
  type StructuredQuoteData,
  type UserRole,
  type VariationOrder,
  type WorkspaceMessage,
} from "./types";

export function hashCobidToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function todayBrisbaneIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date());
}

export function isDateExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const iso = expiresAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return iso < todayBrisbaneIso();
}

const VALID_QUOTE_TYPES = new Set<QuoteType>(["bcq", "sacq", "ccq", "mtq", "custom"]);

function normalizeQuoteTypes(raw: unknown): QuoteType[] {
  if (!Array.isArray(raw)) return ["bcq", "sacq", "custom"];
  const valid = raw.filter((v): v is QuoteType => typeof v === "string" && VALID_QUOTE_TYPES.has(v as QuoteType));
  return valid.length > 0 ? valid : ["custom"];
}

function normalizeQuoteType(raw: unknown): QuoteType {
  return typeof raw === "string" && VALID_QUOTE_TYPES.has(raw as QuoteType)
    ? (raw as QuoteType)
    : "custom";
}

interface DbOpCoRow {
  id: string;
  org_id: string;
  key: string;
  trade_category: string;
  company_name: string;
  legal_entity_name?: string | null;
  trading_name?: string | null;
  abn: string;
  acn?: string | null;
  gst_registered?: boolean | null;
  licence_number: string;
  monogram: string;
  contact_name: string;
  contact_email: string;
  phone?: string | null;
  logo_path?: string | null;
  service_regions?: string[] | null;
  allowed_quote_types?: QuoteType[] | null;
  terms_and_conditions?: string | null;
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
  onboarding_status?: string | null;
  onboarding_token?: string | null;
  onboarding_expires_at?: string | null;
  deed_signed_at?: string | null;
  deed_signed_by?: string | null;
  deed_signed_title?: string | null;
  deed_audit_hash?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  review_notes?: string | null;
  is_active: boolean;
}

interface DbOpCoComplianceDocRow {
  id: string;
  opco_id: string;
  org_id: string;
  doc_type: string;
  title: string;
  document_number: string;
  issuer_or_insurer: string;
  coverage_amount: string;
  expires_at: string | null;
  file_path: string;
  file_name: string;
  status: string;
  verified_at: string | null;
  verified_by: string | null;
  rejection_reason: string | null;
}

interface DbOpCoXeroRow {
  opco_id: string;
  tenant_name: string;
  account_code: string;
  invoice_mode: string;
  status: string;
  last_error: string | null;
}

interface DbWorkspaceRow {
  id: string;
  org_id: string;
  linked_job_id?: string | null;
  shared_photo_ids?: string[] | null;
  package_token?: string | null;
  package_sent_at?: string | null;
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
  directory_opco_id?: string | null;
  sequence_order: number;
  depends_on_scope_id: string | null;
  trade_category: string;
  quote_type?: string | null;
  independent_job_ref?: string | null;
  structured_quote_data?: StructuredQuoteData | null;
  bid_token?: string | null;
  bid_token_expires_at?: string | null;
  doc_token?: string | null;
  doc_status?: string | null;
  doc_viewed_at?: string | null;
  doc_decline_reason?: string | null;
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
  xero_deposit_invoice_id?: string | null;
  xero_deposit_invoice_number?: string | null;
  xero_deposit_online_url?: string | null;
  xero_balance_invoice_id?: string | null;
  xero_balance_invoice_number?: string | null;
  xero_balance_online_url?: string | null;
  xero_last_synced_at?: string | null;
  xero_last_error?: string | null;
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

const DEFAULT_XERO_SUMMARY: OpCoXeroSummary = {
  connected: false,
  status: "not_connected",
  accountCode: "200",
  invoiceMode: "authorised",
  lastError: null,
};

function mapComplianceDocRow(r: DbOpCoComplianceDocRow): OpCoComplianceDoc {
  return {
    id: r.id,
    opCoId: r.opco_id,
    docType: r.doc_type as OpCoComplianceDocType,
    title: r.title ?? "",
    documentNumber: r.document_number ?? "",
    issuerOrInsurer: r.issuer_or_insurer ?? "",
    coverageAmount: r.coverage_amount ?? "",
    expiresAt: r.expires_at ?? null,
    filePath: r.file_path,
    fileName: r.file_name ?? "",
    status: (r.status as OpCoComplianceDoc["status"]) || "pending",
    verifiedAt: r.verified_at ?? null,
    verifiedBy: r.verified_by ?? null,
    rejectionReason: r.rejection_reason ?? null,
    isExpired: isDateExpired(r.expires_at),
  };
}

function mapDirectoryRow(
  r: DbOpCoRow,
  complianceDocs: OpCoComplianceDoc[] = [],
  xeroRow?: DbOpCoXeroRow | null
): DirectoryOpCo {
  const hasExpiredCompliance = complianceDocs.some(
    (d) => d.status !== "rejected" && d.isExpired
  );

  const xero: OpCoXeroSummary = xeroRow
    ? {
        connected: xeroRow.status === "connected",
        tenantName: xeroRow.tenant_name || undefined,
        status: (xeroRow.status as OpCoXeroSummary["status"]) || "disconnected",
        accountCode: xeroRow.account_code || "200",
        invoiceMode: xeroRow.invoice_mode === "draft" ? "draft" : "authorised",
        lastError: xeroRow.last_error ?? null,
      }
    : { ...DEFAULT_XERO_SUMMARY };

  return {
    id: r.id,
    key: r.key,
    tradeCategory: r.trade_category,
    companyName: r.company_name,
    legalEntityName: r.legal_entity_name || r.company_name,
    tradingName: r.trading_name || r.company_name,
    abn: r.abn,
    acn: r.acn ?? "",
    gstRegistered: r.gst_registered !== false,
    licenceNumber: r.licence_number,
    monogram: r.monogram,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    phone: r.phone ?? "",
    logoPath: r.logo_path ?? null,
    serviceRegions: Array.isArray(r.service_regions) ? r.service_regions : [],
    allowedQuoteTypes: normalizeQuoteTypes(r.allowed_quote_types),
    termsAndConditions: r.terms_and_conditions ?? "",
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
    onboardingStatus: (r.onboarding_status as OnboardingStatus) || "approved",
    onboardingToken: r.onboarding_token ?? null,
    onboardingExpiresAt: r.onboarding_expires_at ?? null,
    deedSignedAt: r.deed_signed_at ?? null,
    deedSignedBy: r.deed_signed_by ?? null,
    deedSignedTitle: r.deed_signed_title ?? null,
    deedAuditHash: r.deed_audit_hash ?? null,
    approvedAt: r.approved_at ?? null,
    approvedBy: r.approved_by ?? null,
    reviewNotes: r.review_notes ?? null,
    complianceDocs,
    hasExpiredCompliance,
    xero,
    isActive: r.is_active !== false,
  };
}

async function hydrateDirectoryOpCos(rows: DbOpCoRow[]): Promise<DirectoryOpCo[]> {
  if (rows.length === 0) return [];
  const supabase = createServiceClient();
  const ids = rows.map((r) => r.id);

  const [docsRes, xeroRes] = await Promise.all([
    supabase
      .from("cobid_opco_compliance_docs")
      .select("*")
      .in("opco_id", ids)
      .order("created_at", { ascending: false }),
    supabase
      .from("cobid_opco_xero_connections")
      .select("opco_id, tenant_name, account_code, invoice_mode, status, last_error")
      .in("opco_id", ids),
  ]);

  const docsByOpCo = new Map<string, OpCoComplianceDoc[]>();
  if (!docsRes.error && Array.isArray(docsRes.data)) {
    for (const row of docsRes.data as DbOpCoComplianceDocRow[]) {
      const list = docsByOpCo.get(row.opco_id) ?? [];
      list.push(mapComplianceDocRow(row));
      docsByOpCo.set(row.opco_id, list);
    }
  }

  const xeroByOpCo = new Map<string, DbOpCoXeroRow>();
  if (!xeroRes.error && Array.isArray(xeroRes.data)) {
    for (const row of xeroRes.data as DbOpCoXeroRow[]) {
      xeroByOpCo.set(row.opco_id, row);
    }
  }

  return rows.map((r) =>
    mapDirectoryRow(r, docsByOpCo.get(r.id) ?? [], xeroByOpCo.get(r.id) ?? null)
  );
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
      legal_entity_name: tpl.companyName,
      trading_name: tpl.companyName,
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
      onboarding_status: "approved",
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
  return hydrateDirectoryOpCos((data ?? []) as DbOpCoRow[]);
}

export async function getDirectoryOpCoById(
  orgId: string,
  opcoId: string
): Promise<DirectoryOpCo | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("cobid_opcos")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", opcoId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  const hydrated = await hydrateDirectoryOpCos([data as DbOpCoRow]);
  return hydrated[0] ?? null;
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

  const row: Record<string, unknown> = {
    org_id: orgId,
    key,
    trade_category: input.tradeCategory.trim(),
    company_name: input.companyName.trim(),
    legal_entity_name: (input.legalEntityName ?? input.companyName).trim(),
    trading_name: (input.tradingName ?? input.companyName).trim(),
    abn: (input.abn ?? "").trim(),
    acn: (input.acn ?? "").trim(),
    gst_registered: input.gstRegistered !== undefined ? Boolean(input.gstRegistered) : true,
    licence_number: (input.licenceNumber ?? "").trim(),
    monogram,
    contact_name: (input.contactName ?? "").trim(),
    contact_email: (input.contactEmail ?? "").trim(),
    phone: (input.phone ?? "").trim(),
    service_regions: Array.isArray(input.serviceRegions) ? input.serviceRegions : [],
    allowed_quote_types: normalizeQuoteTypes(input.allowedQuoteTypes),
    terms_and_conditions: (input.termsAndConditions ?? "").trim(),
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

  if (input.logoPath !== undefined) {
    row.logo_path = input.logoPath;
  }
  if (input.onboardingStatus) {
    row.onboarding_status = input.onboardingStatus;
  }

  if (input.id) {
    const { data, error } = await supabase
      .from("cobid_opcos")
      .update(row)
      .eq("id", input.id)
      .eq("org_id", orgId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const hydrated = await hydrateDirectoryOpCos([data as DbOpCoRow]);
    return hydrated[0];
  }

  const { data, error } = await supabase
    .from("cobid_opcos")
    .upsert(row, { onConflict: "org_id,key" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const hydrated = await hydrateDirectoryOpCos([data as DbOpCoRow]);
  return hydrated[0];
}

export async function createOpCoOnboardingInvite(
  orgId: string,
  input: {
    companyName: string;
    tradeCategory: string;
    contactName?: string;
    contactEmail: string;
    phone?: string;
    allowedQuoteTypes?: QuoteType[];
  }
): Promise<{ opCo: DirectoryOpCo; token: string }> {
  const supabase = createServiceClient();
  const baseKey =
    input.companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 38) || "opco";
  const key = `${baseKey}-${crypto.randomBytes(3).toString("hex")}`;
  const monogram =
    (input.companyName
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2) || "OP"
    ).toUpperCase();

  const token = generateCobidToken();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("cobid_opcos")
    .insert({
      org_id: orgId,
      key,
      trade_category: input.tradeCategory.trim(),
      company_name: input.companyName.trim(),
      legal_entity_name: input.companyName.trim(),
      trading_name: input.companyName.trim(),
      monogram,
      contact_name: (input.contactName ?? "").trim(),
      contact_email: input.contactEmail.trim().toLowerCase(),
      phone: (input.phone ?? "").trim(),
      allowed_quote_types: normalizeQuoteTypes(input.allowedQuoteTypes),
      onboarding_status: "invited",
      onboarding_token: token,
      onboarding_expires_at: expiresAt,
      default_deposit_pct: 30,
      is_active: true,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to create OpCo onboarding invite");
  }

  const hydrated = await hydrateDirectoryOpCos([data as DbOpCoRow]);
  return { opCo: hydrated[0], token };
}

export async function getOpCoByOnboardingToken(
  token: string
): Promise<{ opCo: DirectoryOpCo; orgId: string; expired: boolean } | null> {
  if (!token || token.length < 16) return null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("cobid_opcos")
    .select("*")
    .eq("onboarding_token", token)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as DbOpCoRow;
  const expired =
    Boolean(row.onboarding_expires_at) &&
    new Date(row.onboarding_expires_at as string).getTime() < Date.now() &&
    row.onboarding_status !== "approved";

  const hydrated = await hydrateDirectoryOpCos([row]);
  return { opCo: hydrated[0], orgId: row.org_id, expired };
}

export async function reviewDirectoryOpCo(
  orgId: string,
  opcoId: string,
  reviewerName: string,
  action: "approve" | "request_changes" | "suspend",
  notes?: string
): Promise<DirectoryOpCo> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const update: Record<string, unknown> = {
    updated_at: now,
    review_notes: notes?.trim() || null,
  };

  if (action === "approve") {
    update.onboarding_status = "approved";
    update.approved_at = now;
    update.approved_by = reviewerName;
  } else if (action === "request_changes") {
    update.onboarding_status = "in_progress";
  } else if (action === "suspend") {
    update.onboarding_status = "suspended";
  }

  const { data, error } = await supabase
    .from("cobid_opcos")
    .update(update)
    .eq("id", opcoId)
    .eq("org_id", orgId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to update OpCo review status");
  }
  const hydrated = await hydrateDirectoryOpCos([data as DbOpCoRow]);
  return hydrated[0];
}

export async function reviewOpCoComplianceDoc(
  orgId: string,
  opcoId: string,
  docId: string,
  reviewerName: string,
  action: "verify" | "reject",
  rejectionReason?: string
): Promise<DirectoryOpCo> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const update =
    action === "verify"
      ? {
          status: "verified",
          verified_at: now,
          verified_by: reviewerName,
          rejection_reason: null,
          updated_at: now,
        }
      : {
          status: "rejected",
          verified_at: null,
          verified_by: null,
          rejection_reason: rejectionReason?.trim() || "Document rejected — please upload an updated copy.",
          updated_at: now,
        };

  const { error } = await supabase
    .from("cobid_opco_compliance_docs")
    .update(update)
    .eq("id", docId)
    .eq("opco_id", opcoId)
    .eq("org_id", orgId);

  if (error) throw new Error(error.message);

  const reloaded = await getDirectoryOpCoById(orgId, opcoId);
  if (!reloaded) throw new Error("OpCo not found");
  return reloaded;
}

export async function reissueOpCoOnboardingToken(
  orgId: string,
  opcoId: string
): Promise<{ opCo: DirectoryOpCo; token: string }> {
  const supabase = createServiceClient();
  const token = generateCobidToken();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("cobid_opcos")
    .update({
      onboarding_token: token,
      onboarding_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", opcoId)
    .eq("org_id", orgId)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Failed to reissue onboarding token");
  const hydrated = await hydrateDirectoryOpCos([data as DbOpCoRow]);
  return { opCo: hydrated[0], token };
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

function defaultDocUrl(token: string, req?: Request): string {
  if (req) return buildCobidDocUrl(req, token);
  const configured = process.env.NEXT_PUBLIC_COBID_DOCS_URL?.trim().replace(/\/+$/, "");
  return `${configured || "https://docs.hazmatmanagement.com.au"}/${token}`;
}

function defaultPackageUrl(token: string, req?: Request): string {
  if (req) return buildCobidPackageUrl(req, token);
  const configured = process.env.NEXT_PUBLIC_COBID_DOCS_URL?.trim().replace(/\/+$/, "");
  return `${configured || "https://docs.hazmatmanagement.com.au"}/pkg/${token}`;
}

function defaultBidUrl(token: string, req?: Request): string {
  if (req) return buildCobidBidUrl(req, token);
  const configured = process.env.NEXT_PUBLIC_COBID_URL?.trim().replace(/\/+$/, "");
  return `${configured || "https://app.hazmatmanagement.com.au"}/bid/${token}`;
}

async function hydrateWorkspaces(
  orgId: string,
  workspaces: DbWorkspaceRow[],
  role?: UserRole,
  req?: Request
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
      directoryOpCoId: o.directory_opco_id ?? undefined,
      sequenceOrder: o.sequence_order,
      dependsOnOpCoId: o.depends_on_scope_id ?? undefined,
      tradeCategory: o.trade_category,
      quoteType: normalizeQuoteType(o.quote_type),
      independentJobRef: o.independent_job_ref ?? undefined,
      structuredQuoteData: isRingFencedOther
        ? undefined
        : o.structured_quote_data && typeof o.structured_quote_data === "object"
          ? o.structured_quote_data
          : undefined,
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
      docStatus: (o.doc_status as OpCoScope["docStatus"]) || "not_sent",
      docUrl:
        !isRingFencedOther && o.doc_token ? defaultDocUrl(o.doc_token, req) : undefined,
      docViewedAt: o.doc_viewed_at ?? undefined,
      docDeclineReason: isRingFencedOther ? undefined : o.doc_decline_reason ?? undefined,
      bidUrl:
        !isRingFencedOther && o.bid_token ? defaultBidUrl(o.bid_token, req) : undefined,
      xeroDepositInvoiceId: isRingFencedOther ? undefined : o.xero_deposit_invoice_id ?? undefined,
      xeroDepositInvoiceNumber: isRingFencedOther
        ? undefined
        : o.xero_deposit_invoice_number ?? undefined,
      xeroDepositOnlineUrl: isRingFencedOther
        ? undefined
        : o.xero_deposit_online_url ?? undefined,
      xeroBalanceInvoiceId: isRingFencedOther ? undefined : o.xero_balance_invoice_id ?? undefined,
      xeroBalanceInvoiceNumber: isRingFencedOther
        ? undefined
        : o.xero_balance_invoice_number ?? undefined,
      xeroBalanceOnlineUrl: isRingFencedOther
        ? undefined
        : o.xero_balance_online_url ?? undefined,
      xeroLastSyncedAt: isRingFencedOther ? undefined : o.xero_last_synced_at ?? undefined,
      xeroLastError: isRingFencedOther ? undefined : o.xero_last_error ?? undefined,
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
    linkedJobId: job.linked_job_id ?? undefined,
    sharedPhotoIds: Array.isArray(job.shared_photo_ids) ? job.shared_photo_ids : [],
    packageUrl:
      !isContractor && job.package_token ? defaultPackageUrl(job.package_token, req) : undefined,
    packageSentAt: job.package_sent_at ?? undefined,
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
  opts?: { workspaceId?: string; role?: UserRole; req?: Request }
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
  return hydrateWorkspaces(orgId, (data ?? []) as DbWorkspaceRow[], opts?.role, opts?.req);
}

export async function getWorkspaceById(
  orgId: string,
  workspaceId: string,
  role?: UserRole,
  req?: Request
): Promise<JobWorkspace | null> {
  const rows = await listWorkspaces(orgId, { workspaceId, role, req });
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
  quoteTypesByOpCo?: Record<string, QuoteType>;
  linkedJobId?: string | null;
  sharedPhotoIds?: string[];
}

export async function createWorkspace(
  orgId: string,
  input: CreateWorkspaceInput,
  req?: Request
): Promise<JobWorkspace> {
  const directory = await listDirectoryOpCos(orgId);
  const templates = input.selectedOpCoKeys
    .map((k) => directory.find((t) => t.key === k || t.id === k))
    .filter((t): t is DirectoryOpCo => Boolean(t));

  if (templates.length === 0) {
    throw new Error("No valid OpCos selected");
  }

  // Mandatory Phase 1 compliance & onboarding approval gate
  for (const tpl of templates) {
    if (tpl.onboardingStatus !== "approved") {
      throw new Error(
        `${tpl.companyName} cannot be invited to a workspace because its onboarding status is "${tpl.onboardingStatus}". Approve the operator first.`
      );
    }
    if (tpl.hasExpiredCompliance) {
      throw new Error(
        `${tpl.companyName} has expired compliance or insurance documentation and cannot be added to a new workspace until renewed.`
      );
    }
  }

  const supabase = createServiceClient();
  const num = Math.floor(1000 + Math.random() * 8999);
  const ref = `CB-${new Date().getFullYear()}-${num}`;

  const { data: wsData, error: wsErr } = await supabase
    .from("cobid_workspaces")
    .insert({
      org_id: orgId,
      linked_job_id: input.linkedJobId || null,
      shared_photo_ids: Array.isArray(input.sharedPhotoIds) ? input.sharedPhotoIds : [],
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
    const requestedQt =
      input.quoteTypesByOpCo?.[tpl.key] ??
      input.quoteTypesByOpCo?.[tpl.id] ??
      tpl.allowedQuoteTypes[0] ??
      "custom";
    const quoteType = normalizeQuoteType(requestedQt);
    const qtCode = QUOTE_TYPE_META[quoteType].code;
    const independentJobRef = `${qtCode}-${num}-${idx + 1}`;

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
          quote_type: quoteType,
          independent_job_ref: independentJobRef,
          structured_quote_data: {},
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
          doc_status: "not_sent",
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
    summary: `Created Co-Bid Workspace ${ref} with ${templates.length} approved independent OpCos (${input.leadSourceType || "Direct Client"}).`,
  });

  await supabase.from("cobid_messages").insert({
    workspace_id: workspaceId,
    org_id: orgId,
    channel: "shared_ops",
    timestamp_label: nowAuLabel(),
    sender_name: input.coordinatorName,
    sender_role_label: "Scoping Desk",
    body: `Workspace ${ref} initialised for ${input.propertyAddress}. Each independent operator can now build and approve their own structured quote.`,
  });

  const created = await getWorkspaceById(orgId, workspaceId, undefined, req);
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
