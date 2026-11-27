import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generateCobidToken, resolveCobidSession } from "@/lib/cobid/session";
import { addCobidAuditEvent, getWorkspaceById } from "@/lib/cobid/store";
import { buildCobidBidUrl } from "@/lib/cobid/hosts";
import { sendCobidBidInviteEmail } from "@/lib/cobid/email";
import { QUOTE_TYPE_META, type QuoteType } from "@/lib/cobid/types";

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
      return NextResponse.json({ error: "Only coordinators can issue bid invites" }, { status: 403 });
    }

    const { jobId } = await context.params;
    const body = await req.json();
    const opCoId = String(body?.opCoId ?? "");
    const sendEmail = body?.sendEmail !== false;
    const overrideEmail = typeof body?.email === "string" ? body.email.trim() : "";

    if (!opCoId) {
      return NextResponse.json({ error: "opCoId is required" }, { status: 400 });
    }

    const workspace = await getWorkspaceById(session.orgId, jobId, { type: "coordinator" }, req);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const scope = workspace.opCos.find((o) => o.id === opCoId);
    if (!scope) {
      return NextResponse.json({ error: "Scope not found" }, { status: 404 });
    }

    const supabase = createServiceClient();
    const bidToken = generateCobidToken();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const nextScopeStatus =
      scope.scopeStatus === "draft" || scope.scopeStatus === "revision_requested"
        ? "pending_contractor"
        : scope.scopeStatus;

    const { error: updateErr } = await supabase
      .from("cobid_scopes")
      .update({
        bid_token: bidToken,
        bid_token_expires_at: expiresAt,
        scope_status: nextScopeStatus,
      })
      .eq("id", scope.id)
      .eq("org_id", session.orgId);

    if (updateErr) throw new Error(updateErr.message);

    const bidUrl = buildCobidBidUrl(req, bidToken);
    const qt = (QUOTE_TYPE_META[scope.quoteType as QuoteType] ?? QUOTE_TYPE_META.custom).label;
    const targetEmail = overrideEmail || scope.contactEmail;

    let emailSent = false;
    let emailError: string | undefined;

    if (sendEmail && targetEmail) {
      const res = await sendCobidBidInviteEmail({
        to: targetEmail,
        contactName: scope.contactName || scope.companyName,
        companyName: scope.companyName,
        quoteTypeLabel: qt,
        workspaceRef: workspace.reference,
        propertyAddress: `${workspace.propertyAddress}${workspace.suburbState ? `, ${workspace.suburbState}` : ""}`,
        stageOrder: scope.sequenceOrder,
        bidUrl,
      });
      emailSent = res.sent;
      emailError = res.error;
    }

    await addCobidAuditEvent({
      orgId: session.orgId,
      workspaceId: jobId,
      actor: session.name,
      category: "scope",
      summary: `Issued ${qt} Quote-Builder invite link to ${scope.companyName}${emailSent ? ` (${targetEmail})` : ""}.`,
      restrictedToScopeId: scope.id,
    });

    const updatedJob = await getWorkspaceById(session.orgId, jobId, { type: "coordinator" }, req);

    return NextResponse.json({
      bidUrl,
      emailSent,
      emailError,
      job: updatedJob,
    });
  } catch (err) {
    console.error("POST /api/cobid/workspaces/[jobId]/bid-invites error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to issue bid invite" },
      { status: 500 }
    );
  }
}
