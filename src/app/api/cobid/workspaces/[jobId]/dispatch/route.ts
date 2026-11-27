import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generateCobidToken, resolveCobidSession } from "@/lib/cobid/session";
import {
  addCobidAuditEvent,
  getDirectoryOpCoById,
  getWorkspaceById,
  hashCobidToken,
} from "@/lib/cobid/store";
import { buildCobidDocUrl, buildCobidPackageUrl } from "@/lib/cobid/hosts";
import { sendCobidPackageEmail } from "@/lib/cobid/email";
import { renderIndependentEntityDocHtml } from "@/lib/cobid/docRenderer";
import { calcTotals, formatAUD, nowAuLabel } from "@/lib/cobid/utils";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const session = await resolveCobidSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.roleType !== "coordinator") {
      return NextResponse.json(
        { error: "Only coordinators can dispatch separate entity documents" },
        { status: 403 }
      );
    }

    const { jobId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const sendEmail = body?.sendEmail !== false;

    const workspace = await getWorkspaceById(session.orgId, jobId, { type: "coordinator" }, req);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    if (workspace.opCos.length === 0) {
      return NextResponse.json({ error: "Workspace has no operating companies" }, { status: 400 });
    }

    const unapproved = workspace.opCos.filter((o) => o.scopeStatus !== "contractor_approved");
    if (unapproved.length > 0) {
      return NextResponse.json(
        {
          error: `All operating companies must approve & lock their quote before dispatch. Pending: ${unapproved.map((u) => u.companyName).join(", ")}.`,
        },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const nowIso = new Date().toISOString();
    const nowLabel = nowAuLabel();
    const expiresIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Load existing raw tokens so re-dispatching preserves already-issued links
    const { data: existingScopes } = await supabase
      .from("cobid_scopes")
      .select("id, doc_token, doc_status")
      .eq("workspace_id", jobId)
      .eq("org_id", session.orgId);

    const existingTokenMap = new Map<string, { docToken: string | null; docStatus: string }>();
    for (const row of (existingScopes ?? []) as Array<Record<string, unknown>>) {
      existingTokenMap.set(String(row.id), {
        docToken: row.doc_token ? String(row.doc_token) : null,
        docStatus: String(row.doc_status || "not_sent"),
      });
    }

    const dispatchedDocs: Array<{
      scopeId: string;
      stageOrder: number;
      companyName: string;
      abn: string;
      tradeCategory: string;
      independentJobRef: string;
      totalIncGstLabel: string;
      docUrl: string;
    }> = [];

    for (const scope of workspace.opCos) {
      const existing = existingTokenMap.get(scope.id);
      const rawDocToken = existing?.docToken || generateCobidToken();
      const docTokenHash = hashCobidToken(rawDocToken);
      const alreadySigned =
        scope.agreementStatus === "signed" || existing?.docStatus === "signed";

      const dirOpCo = scope.directoryOpCoId
        ? await getDirectoryOpCoById(session.orgId, scope.directoryOpCoId)
        : null;

      const logoUrl = dirOpCo?.logoPath
        ? `/api/cobid/files?path=${encodeURIComponent(dirOpCo.logoPath)}&docToken=${encodeURIComponent(rawDocToken)}`
        : null;

      const snapshotHtml = renderIndependentEntityDocHtml({
        workspace,
        scope,
        directoryOpCo: dirOpCo,
        logoUrl,
      });

      const updatePatch: Record<string, unknown> = {
        doc_token: rawDocToken,
        doc_token_hash: docTokenHash,
        doc_expires_at: expiresIso,
      };

      if (!alreadySigned) {
        updatePatch.doc_snapshot_html = snapshotHtml;
        updatePatch.doc_status = "open";
        updatePatch.agreement_status = "sent_to_client";
        updatePatch.agreement_sent_at = nowLabel;
      }

      const { error: scopeErr } = await supabase
        .from("cobid_scopes")
        .update(updatePatch)
        .eq("id", scope.id)
        .eq("org_id", session.orgId);

      if (scopeErr) throw new Error(scopeErr.message);

      const totals = calcTotals(scope.lineItems, scope.depositPercent, scope.variations);
      const gstRegistered = dirOpCo ? dirOpCo.gstRegistered : true;
      const totalAmt = gstRegistered ? totals.baseSubtotal * 1.1 : totals.baseSubtotal;
      const docUrl = buildCobidDocUrl(req, rawDocToken);

      dispatchedDocs.push({
        scopeId: scope.id,
        stageOrder: scope.sequenceOrder,
        companyName: scope.companyName,
        abn: scope.abn,
        tradeCategory: scope.tradeCategory,
        independentJobRef: scope.independentJobRef || scope.agreementRef,
        totalIncGstLabel: formatAUD(totalAmt),
        docUrl,
      });
    }

    const { data: wsRow } = await supabase
      .from("cobid_workspaces")
      .select("package_token")
      .eq("id", jobId)
      .eq("org_id", session.orgId)
      .single();

    const rawPackageToken =
      (wsRow?.package_token ? String(wsRow.package_token) : null) || generateCobidToken();
    const packageTokenHash = hashCobidToken(rawPackageToken);

    const { error: wsErr } = await supabase
      .from("cobid_workspaces")
      .update({
        package_token: rawPackageToken,
        package_token_hash: packageTokenHash,
        package_sent_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", jobId)
      .eq("org_id", session.orgId);

    if (wsErr) throw new Error(wsErr.message);

    const packageUrl = buildCobidPackageUrl(req, rawPackageToken);

    let emailSent = false;
    let emailError: string | undefined;
    if (sendEmail && workspace.clientEmail) {
      const emailRes = await sendCobidPackageEmail({
        to: workspace.clientEmail,
        clientName: workspace.clientName,
        propertyAddress: `${workspace.propertyAddress}${workspace.suburbState ? `, ${workspace.suburbState}` : ""}`,
        packageUrl,
        documents: dispatchedDocs,
      });
      emailSent = emailRes.sent;
      emailError = emailRes.error;
    }

    await addCobidAuditEvent({
      orgId: session.orgId,
      workspaceId: jobId,
      actor: session.name,
      category: "legal",
      summary: `Dispatched ${dispatchedDocs.length} separate independent entity document links on docs.hazmatmanagement.com.au${emailSent ? ` to ${workspace.clientEmail}` : ""}.`,
    });

    const updatedJob = await getWorkspaceById(session.orgId, jobId, { type: "coordinator" }, req);

    return NextResponse.json({
      packageUrl,
      documents: dispatchedDocs,
      emailSent,
      emailError,
      job: updatedJob,
    });
  } catch (err) {
    console.error("POST /api/cobid/workspaces/[jobId]/dispatch error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to dispatch documents" },
      { status: 500 }
    );
  }
}
