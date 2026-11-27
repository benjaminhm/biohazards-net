/*
 * lib/cobid/xero.ts
 *
 * Per-OpCo Xero OAuth 2.0 & direct invoicing engine for Co-Bid.
 * Reuses biohazards-net's AES-256-GCM token encryption and minimal Xero scopes
 * (`openid profile email offline_access accounting.contacts accounting.invoices`)
 * so every independent Operating Company raises invoices under its own ABN/Xero org.
 */
import { createServiceClient } from "@/lib/supabase";
import { decryptToken, encryptToken } from "@/lib/xero/crypto";
import { XERO_SCOPES, xeroConfigured, xeroErrorDetail } from "@/lib/xero/client";
import { brisbaneDate, contactSearchTerm, xeroContactBody } from "@/lib/xero/invoice";
import { invoicePaid, xeroPayUrl } from "@/lib/xero/payments";
import { isCobidHost } from "./hosts";
import { addCobidAuditEvent } from "./store";
import { calcTotals, nowAuLabel } from "./utils";
import type { LineItem, VariationOrder } from "./types";

export const COBID_XERO_STATE_COOKIE = "bh_cobid_xero_state";

const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";
const API_BASE = "https://api.xero.com/api.xro/2.0";

export { xeroConfigured };

export interface OpCoXeroConnectionRow {
  id: string;
  opco_id: string;
  org_id: string;
  tenant_id: string;
  tenant_name: string;
  access_token_enc: string;
  refresh_token_enc: string;
  expires_at: string;
  scopes: string;
  account_code: string;
  gst_tax_type: string;
  no_gst_tax_type: string;
  due_days: number;
  invoice_mode: "authorised" | "draft";
  status: "connected" | "disconnected" | "error";
  last_error: string | null;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
}

interface XeroTenant {
  tenantId: string;
  tenantName: string;
  tenantType: string;
  createdDateUtc?: string;
}

function basicAuth(): string {
  const id = process.env.XERO_CLIENT_ID?.trim() ?? "";
  const secret = process.env.XERO_CLIENT_SECRET?.trim() ?? "";
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

async function tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token || !body.refresh_token) {
    throw new Error(
      `Xero token request failed (${res.status}${body.error ? `: ${body.error}` : ""})`
    );
  }
  return body as TokenResponse;
}

export function cobidXeroRedirectUri(req: Request): string {
  const explicit = process.env.COBID_XERO_REDIRECT_URI?.trim();
  if (explicit) return explicit;

  const hostHeader = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const host = hostHeader.split(",")[0].trim();
  const isLocal =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("0.0.0.0");

  if (isCobidHost(host)) {
    return `https://${host.split(":")[0]}/api/cobid/xero/callback`;
  }
  if (isLocal && host) {
    return `http://${host}/api/cobid/xero/callback`;
  }
  const configuredPrimary = process.env.NEXT_PUBLIC_COBID_URL?.trim().replace(/\/+$/, "");
  if (configuredPrimary) {
    return `${configuredPrimary}/api/cobid/xero/callback`;
  }
  if (host) {
    const proto = (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0].trim();
    return `${proto}://${host}/api/cobid/xero/callback`;
  }
  return "https://app.hazmatmanagement.com.au/api/cobid/xero/callback";
}

export function cobidXeroAuthorizeUrl(state: string, redirectUri: string): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: process.env.XERO_CLIENT_ID?.trim() ?? "",
    redirect_uri: redirectUri,
    scope: XERO_SCOPES,
    state,
  });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

export async function completeOpCoXeroConnection(
  opcoId: string,
  orgId: string,
  code: string,
  redirectUri: string
): Promise<{ tenantId: string; tenantName: string }> {
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const connRes = await fetch(CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const tenants = (await connRes.json().catch(() => [])) as XeroTenant[];
  const orgs = (Array.isArray(tenants) ? tenants : []).filter(
    (t) => t.tenantType === "ORGANISATION"
  );
  if (!orgs.length) {
    throw new Error("No Xero organisation was authorised");
  }
  orgs.sort((a, b) => (b.createdDateUtc ?? "").localeCompare(a.createdDateUtc ?? ""));
  const tenant = orgs[0];

  const supabase = createServiceClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("cobid_opco_xero_connections").upsert(
    {
      opco_id: opcoId,
      org_id: orgId,
      tenant_id: tenant.tenantId,
      tenant_name: tenant.tenantName ?? "",
      access_token_enc: encryptToken(tokens.access_token),
      refresh_token_enc: encryptToken(tokens.refresh_token),
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: tokens.scope ?? XERO_SCOPES,
      status: "connected",
      last_error: null,
      connected_at: now,
      updated_at: now,
    },
    { onConflict: "opco_id" }
  );

  if (error) {
    throw new Error(`Saving OpCo Xero connection failed: ${error.message}`);
  }

  return { tenantId: tenant.tenantId, tenantName: tenant.tenantName ?? "" };
}

export async function getValidOpCoXeroToken(
  opcoId: string
): Promise<{ accessToken: string; conn: OpCoXeroConnectionRow } | null> {
  if (!xeroConfigured()) return null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("cobid_opco_xero_connections")
    .select("*")
    .eq("opco_id", opcoId)
    .maybeSingle();

  if (error || !data) return null;
  const conn = data as OpCoXeroConnectionRow;
  if (conn.status === "disconnected") return null;

  if (new Date(conn.expires_at).getTime() - Date.now() > 120_000) {
    return { accessToken: decryptToken(conn.access_token_enc), conn };
  }

  try {
    const tokens = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: decryptToken(conn.refresh_token_enc),
    });
    const update = {
      access_token_enc: encryptToken(tokens.access_token),
      refresh_token_enc: encryptToken(tokens.refresh_token),
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      status: "connected" as const,
      last_error: null,
      updated_at: new Date().toISOString(),
    };
    await supabase
      .from("cobid_opco_xero_connections")
      .update(update)
      .eq("opco_id", opcoId);
    Object.assign(conn, update);
    return { accessToken: tokens.access_token, conn };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Xero token refresh failed";
    await supabase
      .from("cobid_opco_xero_connections")
      .update({ status: "error", last_error: msg, updated_at: new Date().toISOString() })
      .eq("opco_id", opcoId);
    throw new Error(msg);
  }
}

async function opCoXeroFetch<T>(
  opcoId: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  idempotencyKey?: string
): Promise<{ data: T; conn: OpCoXeroConnectionRow }> {
  const auth = await getValidOpCoXeroToken(opcoId);
  if (!auth) throw new Error("OpCo Xero connection is not active");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
    "Xero-tenant-id": auth.conn.tenant_id,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    const { detail } = xeroErrorDetail(await res.text().catch(() => ""));
    throw new Error(
      `Xero ${method} ${path.split("?")[0]} failed (${res.status})${detail ? `: ${detail}` : ""}`
    );
  }

  const parsed = (await res.json().catch(() => null)) as T;
  return { data: parsed, conn: auth.conn };
}

async function findOrCreateXeroContact(
  opcoId: string,
  client: { name: string; email: string; phone: string }
): Promise<string> {
  const email = client.email.trim().toLowerCase();
  const name = client.name.trim() || email || "Co-Bid Client";

  const terms = [email, name].map(contactSearchTerm).filter(Boolean);
  for (const term of terms) {
    try {
      const { data } = await opCoXeroFetch<{
        Contacts?: Array<{
          ContactID?: string;
          Name?: string;
          EmailAddress?: string;
          ContactStatus?: string;
        }>;
      }>(opcoId, "GET", `/Contacts?searchTerm=${encodeURIComponent(term)}`);

      const active = (data?.Contacts ?? []).filter(
        (c) => c.ContactID && c.ContactStatus !== "ARCHIVED"
      );
      const exactEmail = email
        ? active.find((c) => (c.EmailAddress ?? "").trim().toLowerCase() === email)
        : undefined;
      if (exactEmail?.ContactID) return exactEmail.ContactID;

      const exactName = active.find(
        (c) => (c.Name ?? "").trim().toLowerCase() === name.toLowerCase()
      );
      if (exactName?.ContactID) return exactName.ContactID;
    } catch {
      // Fall through to create
    }
  }

  const { data: created } = await opCoXeroFetch<{
    Contacts?: Array<{ ContactID?: string }>;
  }>(opcoId, "POST", "/Contacts", {
    Contacts: [
      xeroContactBody({
        name,
        email: client.email.trim(),
        phone: client.phone.trim(),
      }),
    ],
  });

  const contactId = created?.Contacts?.[0]?.ContactID;
  if (!contactId) throw new Error("Xero did not return a ContactID");
  return contactId;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface RaiseInvoiceResult {
  ok: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  onlineUrl?: string | null;
  error?: string;
}

/**
 * Raises a deposit or balance invoice inside *that specific OpCo's* Xero account.
 * Never throws — failures are persisted to `xero_last_error` so client signing
 * cleanly falls back to that OpCo's direct EFT / PayID bank details.
 */
export async function raiseOpCoXeroInvoice(
  scopeId: string,
  kind: "deposit" | "balance"
): Promise<RaiseInvoiceResult> {
  const supabase = createServiceClient();

  try {
    if (!xeroConfigured()) {
      return { ok: false, error: "Xero integration is not configured on this server" };
    }

    const { data: scopeRow, error: scopeErr } = await supabase
      .from("cobid_scopes")
      .select("*")
      .eq("id", scopeId)
      .maybeSingle();

    if (scopeErr || !scopeRow) {
      return { ok: false, error: "Scope not found" };
    }

    const directoryOpCoId = scopeRow.directory_opco_id as string | null;
    if (!directoryOpCoId) {
      return { ok: false, error: "Scope is not linked to an OpCo directory profile" };
    }

    const tokenCheck = await getValidOpCoXeroToken(directoryOpCoId);
    if (!tokenCheck) {
      return { ok: false, error: "OpCo has not connected Xero — using direct EFT fallback" };
    }

    const existingId =
      kind === "deposit"
        ? (scopeRow.xero_deposit_invoice_id as string | null)
        : (scopeRow.xero_balance_invoice_id as string | null);
    const existingNumber =
      kind === "deposit"
        ? (scopeRow.xero_deposit_invoice_number as string | null)
        : (scopeRow.xero_balance_invoice_number as string | null);
    const existingOnline =
      kind === "deposit"
        ? (scopeRow.xero_deposit_online_url as string | null)
        : (scopeRow.xero_balance_online_url as string | null);

    if (existingId) {
      let onlineUrl = xeroPayUrl(existingOnline);
      if (!onlineUrl) {
        try {
          const { data: onlineRes } = await opCoXeroFetch<{
            OnlineInvoices?: { OnlineInvoiceUrl?: string }[];
          }>(directoryOpCoId, "GET", `/Invoices/${encodeURIComponent(existingId)}/OnlineInvoice`);
          onlineUrl = xeroPayUrl(onlineRes?.OnlineInvoices?.[0]?.OnlineInvoiceUrl);
          if (onlineUrl) {
            await supabase
              .from("cobid_scopes")
              .update(
                kind === "deposit"
                  ? {
                      xero_deposit_online_url: onlineUrl,
                      xero_last_synced_at: new Date().toISOString(),
                      xero_last_error: null,
                    }
                  : {
                      xero_balance_online_url: onlineUrl,
                      xero_last_synced_at: new Date().toISOString(),
                      xero_last_error: null,
                    }
              )
              .eq("id", scopeId);
          }
        } catch {
          // Return what we have
        }
      }
      return {
        ok: true,
        invoiceId: existingId,
        invoiceNumber: existingNumber ?? undefined,
        onlineUrl,
      };
    }

    const [wsRes, opcoRes, liRes, varRes] = await Promise.all([
      supabase
        .from("cobid_workspaces")
        .select("*")
        .eq("id", scopeRow.workspace_id)
        .single(),
      supabase
        .from("cobid_opcos")
        .select("gst_registered")
        .eq("id", directoryOpCoId)
        .maybeSingle(),
      supabase
        .from("cobid_line_items")
        .select("*")
        .eq("scope_id", scopeId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("cobid_variations")
        .select("*")
        .eq("scope_id", scopeId),
    ]);

    if (wsRes.error || !wsRes.data) {
      return { ok: false, error: "Workspace not found" };
    }
    const ws = wsRes.data as Record<string, unknown>;
    const gstRegistered = opcoRes.data?.gst_registered !== false;

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
    const variations: VariationOrder[] = ((varRes.data ?? []) as Array<Record<string, unknown>>).map(
      (r) => ({
        id: String(r.id),
        reference: String(r.reference),
        title: String(r.title),
        reason: String(r.reason),
        amountExGst: Number(r.amount_ex_gst),
        status: String(r.status) as VariationOrder["status"],
        createdAt: String(r.created_at_label),
        createdBy: String(r.created_by),
      })
    );

    const depositPct = Number(scopeRow.deposit_percent) || 30;
    const totals = calcTotals(lineItems, depositPct, variations);
    const taxType = gstRegistered
      ? tokenCheck.conn.gst_tax_type || "OUTPUT"
      : tokenCheck.conn.no_gst_tax_type || "EXEMPTOUTPUT";
    const accountCode = tokenCheck.conn.account_code || "200";
    const jobRef =
      (scopeRow.independent_job_ref as string | null) ||
      (scopeRow.agreement_ref as string) ||
      String(ws.reference);

    const contactId = await findOrCreateXeroContact(directoryOpCoId, {
      name: String(ws.client_name || ""),
      email: String(ws.client_email || ""),
      phone: String(ws.client_phone || ""),
    });

    const xeroLines: Array<{
      Description: string;
      Quantity: number;
      UnitAmount: number;
      AccountCode: string;
      TaxType: string;
    }> = [];

    if (kind === "deposit") {
      const depositExGst = round2(totals.baseSubtotal * (depositPct / 100));
      if (depositExGst <= 0) {
        return { ok: false, error: "Deposit amount is $0.00" };
      }
      xeroLines.push({
        Description: `${depositPct}% Deposit — ${scopeRow.trade_category} at ${ws.property_address} (${jobRef})`,
        Quantity: 1,
        UnitAmount: depositExGst,
        AccountCode: accountCode,
        TaxType: taxType,
      });
    } else {
      for (const li of lineItems) {
        xeroLines.push({
          Description: `${li.code}: ${li.description} (${li.unit})`,
          Quantity: li.qty,
          UnitAmount: round2(li.unitPrice),
          AccountCode: accountCode,
          TaxType: taxType,
        });
      }
      for (const v of variations.filter((item) => item.status === "approved")) {
        xeroLines.push({
          Description: `Approved Variation ${v.reference}: ${v.title}`,
          Quantity: 1,
          UnitAmount: round2(v.amountExGst),
          AccountCode: accountCode,
          TaxType: taxType,
        });
      }
      if (scopeRow.deposit_status === "paid" || scopeRow.xero_deposit_invoice_id) {
        const depositExGst = round2(totals.baseSubtotal * (depositPct / 100));
        if (depositExGst > 0) {
          xeroLines.push({
            Description: `Less Deposit (${depositPct}% — ${scopeRow.xero_deposit_invoice_number || scopeRow.deposit_payment_ref || jobRef})`,
            Quantity: 1,
            UnitAmount: -depositExGst,
            AccountCode: accountCode,
            TaxType: taxType,
          });
        }
      }
    }

    const now = new Date();
    const xeroStatus = tokenCheck.conn.invoice_mode === "draft" ? "DRAFT" : "AUTHORISED";
    const payload = {
      Invoices: [
        {
          Type: "ACCREC",
          Status: xeroStatus,
          Contact: { ContactID: contactId },
          Reference: `${jobRef}${kind === "deposit" ? " (Deposit)" : " (Balance)"}`,
          Date: brisbaneDate(now),
          DueDate: brisbaneDate(now, tokenCheck.conn.due_days ?? 7),
          LineAmountTypes: "Exclusive",
          LineItems: xeroLines,
        },
      ],
    };

    const { data: created } = await opCoXeroFetch<{
      Invoices?: Array<{ InvoiceID?: string; InvoiceNumber?: string; Status?: string }>;
    }>(
      directoryOpCoId,
      "POST",
      "/Invoices",
      payload,
      `cobid-${scopeId}-${kind}`
    );

    const invoice = created?.Invoices?.[0];
    if (!invoice?.InvoiceID) {
      throw new Error("Xero did not return an InvoiceID");
    }

    let onlineUrl: string | null = null;
    if (invoice.Status === "AUTHORISED" || xeroStatus === "AUTHORISED") {
      try {
        const { data: onlineRes } = await opCoXeroFetch<{
          OnlineInvoices?: { OnlineInvoiceUrl?: string }[];
        }>(
          directoryOpCoId,
          "GET",
          `/Invoices/${encodeURIComponent(invoice.InvoiceID)}/OnlineInvoice`
        );
        onlineUrl = xeroPayUrl(onlineRes?.OnlineInvoices?.[0]?.OnlineInvoiceUrl);
      } catch (err) {
        console.warn("[cobid/xero] OnlineInvoice lookup failed:", err);
      }
    }

    const updateCols =
      kind === "deposit"
        ? {
            xero_deposit_invoice_id: invoice.InvoiceID,
            xero_deposit_invoice_number: invoice.InvoiceNumber ?? null,
            xero_deposit_online_url: onlineUrl,
            xero_last_synced_at: now.toISOString(),
            xero_last_error: null,
          }
        : {
            xero_balance_invoice_id: invoice.InvoiceID,
            xero_balance_invoice_number: invoice.InvoiceNumber ?? null,
            xero_balance_online_url: onlineUrl,
            xero_last_synced_at: now.toISOString(),
            xero_last_error: null,
          };

    await supabase.from("cobid_scopes").update(updateCols).eq("id", scopeId);

    await addCobidAuditEvent({
      orgId: String(scopeRow.org_id),
      workspaceId: String(scopeRow.workspace_id),
      actor: `${scopeRow.company_name} (Xero Direct)`,
      category: "settlement",
      summary: `Raised ${kind} invoice ${invoice.InvoiceNumber || invoice.InvoiceID} directly in ${scopeRow.company_name}'s Xero account.`,
      restrictedToScopeId: scopeId,
    });

    return {
      ok: true,
      invoiceId: invoice.InvoiceID,
      invoiceNumber: invoice.InvoiceNumber,
      onlineUrl,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to raise Xero invoice";
    await supabase
      .from("cobid_scopes")
      .update({
        xero_last_error: msg,
        xero_last_synced_at: new Date().toISOString(),
      })
      .eq("id", scopeId);
    return { ok: false, error: msg };
  }
}

export interface SyncScopeResult {
  scopeId: string;
  companyName: string;
  depositStatus: string;
  balanceStatus: string;
  updated: boolean;
  error?: string;
}

export async function syncWorkspaceXeroPayments(
  orgId: string,
  workspaceId: string
): Promise<SyncScopeResult[]> {
  const supabase = createServiceClient();
  const { data: scopes, error } = await supabase
    .from("cobid_scopes")
    .select("*")
    .eq("org_id", orgId)
    .eq("workspace_id", workspaceId)
    .order("sequence_order", { ascending: true });

  if (error || !scopes) return [];

  const results: SyncScopeResult[] = [];

  for (const s of scopes as Array<Record<string, unknown>>) {
    const scopeId = String(s.id);
    const companyName = String(s.company_name);
    const directoryOpCoId = s.directory_opco_id ? String(s.directory_opco_id) : null;
    const depositInvId = s.xero_deposit_invoice_id ? String(s.xero_deposit_invoice_id) : null;
    const balanceInvId = s.xero_balance_invoice_id ? String(s.xero_balance_invoice_id) : null;

    let depositStatus = String(s.deposit_status || "pending");
    let balanceStatus = String(s.balance_status || "pending");
    let updated = false;

    if (!directoryOpCoId || (!depositInvId && !balanceInvId)) {
      results.push({ scopeId, companyName, depositStatus, balanceStatus, updated: false });
      continue;
    }

    try {
      const updatePatch: Record<string, unknown> = {
        xero_last_synced_at: new Date().toISOString(),
        xero_last_error: null,
      };

      const checkInvoice = async (invId: string, kind: "deposit" | "balance") => {
        const { data } = await opCoXeroFetch<{
          Invoices?: Array<{
            InvoiceNumber?: string;
            Status?: string;
            AmountPaid?: number;
            AmountDue?: number;
            Payments?: { Date?: string; Amount?: number }[];
          }>;
        }>(directoryOpCoId, "GET", `/Invoices/${encodeURIComponent(invId)}`);

        const inv = data?.Invoices?.[0];
        if (!inv) return;

        const paidInfo = invoicePaid(inv);
        const isPaid =
          inv.Status === "PAID" ||
          (typeof inv.AmountDue === "number" && inv.AmountDue <= 0.01 && (paidInfo?.amount_paid ?? 0) > 0);

        if (kind === "deposit") {
          if (inv.InvoiceNumber) updatePatch.xero_deposit_invoice_number = inv.InvoiceNumber;
          if (!s.xero_deposit_online_url && inv.Status === "AUTHORISED") {
            try {
              const { data: onRes } = await opCoXeroFetch<{
                OnlineInvoices?: { OnlineInvoiceUrl?: string }[];
              }>(directoryOpCoId, "GET", `/Invoices/${encodeURIComponent(invId)}/OnlineInvoice`);
              const url = xeroPayUrl(onRes?.OnlineInvoices?.[0]?.OnlineInvoiceUrl);
              if (url) updatePatch.xero_deposit_online_url = url;
            } catch {
              // Ignore
            }
          }
          if (isPaid && depositStatus !== "paid") {
            depositStatus = "paid";
            updated = true;
            updatePatch.deposit_status = "paid";
            updatePatch.deposit_paid_at = paidInfo?.paid_on || nowAuLabel();
            updatePatch.deposit_payment_ref = inv.InvoiceNumber || invId;
            updatePatch.deposit_method = "Xero Online Invoice";
            await addCobidAuditEvent({
              orgId,
              workspaceId,
              actor: `${companyName} (Xero Sync)`,
              category: "settlement",
              summary: `Confirmed deposit invoice ${inv.InvoiceNumber || invId} PAID directly in ${companyName}'s Xero.`,
              restrictedToScopeId: scopeId,
            });
          }
        } else {
          if (inv.InvoiceNumber) updatePatch.xero_balance_invoice_number = inv.InvoiceNumber;
          if (!s.xero_balance_online_url && inv.Status === "AUTHORISED") {
            try {
              const { data: onRes } = await opCoXeroFetch<{
                OnlineInvoices?: { OnlineInvoiceUrl?: string }[];
              }>(directoryOpCoId, "GET", `/Invoices/${encodeURIComponent(invId)}/OnlineInvoice`);
              const url = xeroPayUrl(onRes?.OnlineInvoices?.[0]?.OnlineInvoiceUrl);
              if (url) updatePatch.xero_balance_online_url = url;
            } catch {
              // Ignore
            }
          }
          if (isPaid && balanceStatus !== "paid") {
            balanceStatus = "paid";
            updated = true;
            updatePatch.balance_status = "paid";
            updatePatch.balance_paid_at = paidInfo?.paid_on || nowAuLabel();
            updatePatch.balance_payment_ref = inv.InvoiceNumber || invId;
            await addCobidAuditEvent({
              orgId,
              workspaceId,
              actor: `${companyName} (Xero Sync)`,
              category: "settlement",
              summary: `Confirmed final balance invoice ${inv.InvoiceNumber || invId} PAID directly in ${companyName}'s Xero.`,
              restrictedToScopeId: scopeId,
            });
          }
        }
      };

      if (depositInvId) await checkInvoice(depositInvId, "deposit");
      if (balanceInvId) await checkInvoice(balanceInvId, "balance");

      await supabase.from("cobid_scopes").update(updatePatch).eq("id", scopeId);
      results.push({ scopeId, companyName, depositStatus, balanceStatus, updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Xero sync failed";
      await supabase
        .from("cobid_scopes")
        .update({ xero_last_error: msg, xero_last_synced_at: new Date().toISOString() })
        .eq("id", scopeId);
      results.push({ scopeId, companyName, depositStatus, balanceStatus, updated: false, error: msg });
    }
  }

  return results;
}
