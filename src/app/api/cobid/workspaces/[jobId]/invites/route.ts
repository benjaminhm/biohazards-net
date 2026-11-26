import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generateCobidToken, resolveCobidSession } from "@/lib/cobid/session";
import { addCobidAuditEvent } from "@/lib/cobid/store";
import { buildCobidInviteUrl } from "@/lib/cobid/hosts";
import { sendCobidInviteEmail } from "@/lib/cobid/email";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const session = await resolveCobidSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.roleType !== "coordinator") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { jobId } = await context.params;
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("cobid_invites")
      .select("id, token, email, recipient_name, role_type, scope_id, status, expires_at, accepted_at, created_at")
      .eq("workspace_id", jobId)
      .eq("org_id", session.orgId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const invites = (data ?? []).map((inv) => ({
      id: inv.id,
      token: inv.token,
      email: inv.email,
      recipientName: inv.recipient_name,
      roleType: inv.role_type,
      opCoId: inv.scope_id,
      status: inv.status,
      expiresAt: inv.expires_at,
      acceptedAt: inv.accepted_at,
      createdAt: inv.created_at,
      inviteUrl: buildCobidInviteUrl(req, inv.token),
    }));

    return NextResponse.json({ invites });
  } catch (err) {
    console.error("GET /api/cobid/workspaces/[jobId]/invites error:", err);
    return NextResponse.json({ error: "Failed to load invites" }, { status: 500 });
  }
}

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
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { jobId } = await context.params;
    const body = await req.json();
    const { email, recipientName, roleType, opCoId, sendEmail = true } = body as {
      email: string;
      recipientName: string;
      roleType: "coordinator" | "contractor" | "client";
      opCoId?: string;
      sendEmail?: boolean;
    };

    if (!email?.trim() || !recipientName?.trim() || !roleType) {
      return NextResponse.json(
        { error: "email, recipientName, and roleType are required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const { data: ws } = await supabase
      .from("cobid_workspaces")
      .select("id, reference, property_address, suburb_state")
      .eq("id", jobId)
      .eq("org_id", session.orgId)
      .maybeSingle();

    if (!ws) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    let opCoName: string | null = null;
    if (roleType === "contractor" && opCoId) {
      const { data: sc } = await supabase
        .from("cobid_scopes")
        .select("company_name")
        .eq("id", opCoId)
        .eq("workspace_id", jobId)
        .eq("org_id", session.orgId)
        .maybeSingle();
      opCoName = sc?.company_name ?? null;
    }

    const token = generateCobidToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

    const { data: inv, error } = await supabase
      .from("cobid_invites")
      .insert({
        org_id: session.orgId,
        workspace_id: jobId,
        token,
        email: email.trim(),
        recipient_name: recipientName.trim(),
        role_type: roleType,
        scope_id: roleType === "contractor" ? opCoId ?? null : null,
        expires_at: expiresAt,
      })
      .select("id, token, email, recipient_name, role_type, scope_id, status, expires_at, accepted_at, created_at")
      .single();

    if (error || !inv) throw new Error(error?.message || "Failed to create invite");

    const inviteUrl = buildCobidInviteUrl(req, inv.token);
    let emailResult: { sent: boolean; error?: string } = { sent: false };

    if (sendEmail) {
      emailResult = await sendCobidInviteEmail({
        to: email.trim(),
        recipientName: recipientName.trim(),
        roleType,
        workspaceRef: ws.reference,
        propertyAddress: `${ws.property_address}, ${ws.suburb_state}`,
        opCoName,
        inviteUrl,
      });
    }

    await addCobidAuditEvent({
      orgId: session.orgId,
      workspaceId: jobId,
      actor: session.name,
      category: "workspace",
      summary: `Generated magic-link workspace invite for ${recipientName.trim()} (${roleType}) — ${email.trim()}${
        emailResult.sent ? " (emailed via Resend)" : ""
      }.`,
      restrictedToScopeId: roleType === "contractor" ? opCoId ?? null : null,
    });

    return NextResponse.json(
      {
        invite: {
          id: inv.id,
          token: inv.token,
          email: inv.email,
          recipientName: inv.recipient_name,
          roleType: inv.role_type,
          opCoId: inv.scope_id,
          status: inv.status,
          expiresAt: inv.expires_at,
          acceptedAt: inv.accepted_at,
          createdAt: inv.created_at,
          inviteUrl,
        },
        emailSent: emailResult.sent,
        emailError: emailResult.error,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/cobid/workspaces/[jobId]/invites error:", err);
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const session = await resolveCobidSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.roleType !== "coordinator") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { jobId } = await context.params;
    const inviteId = req.nextUrl.searchParams.get("inviteId");
    if (!inviteId) {
      return NextResponse.json({ error: "inviteId required" }, { status: 400 });
    }

    const supabase = createServiceClient();
    await supabase
      .from("cobid_invites")
      .update({ status: "revoked" })
      .eq("id", inviteId)
      .eq("workspace_id", jobId)
      .eq("org_id", session.orgId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/cobid/workspaces/[jobId]/invites error:", err);
    return NextResponse.json({ error: "Failed to revoke invite" }, { status: 500 });
  }
}
