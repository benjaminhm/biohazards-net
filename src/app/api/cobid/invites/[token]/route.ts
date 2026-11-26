import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import {
  cobidCookieHeader,
  isSecureCobidRequest,
  signCobidToken,
} from "@/lib/cobid/session";
import { addCobidAuditEvent } from "@/lib/cobid/store";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const supabase = createServiceClient();

    const { data: invite } = await supabase
      .from("cobid_invites")
      .select("id, org_id, workspace_id, email, recipient_name, role_type, scope_id, status, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (!invite) {
      return NextResponse.json({ error: "Invite link not found" }, { status: 404 });
    }

    const { data: job } = await supabase
      .from("cobid_workspaces")
      .select("id, reference, title, property_address, suburb_state, lead_source")
      .eq("id", invite.workspace_id)
      .maybeSingle();

    if (!job) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    let opCo: {
      companyName: string;
      abn: string;
      tradeCategory: string;
      sequenceOrder: number;
    } | null = null;

    if (invite.scope_id) {
      const { data: sc } = await supabase
        .from("cobid_scopes")
        .select("company_name, abn, trade_category, sequence_order")
        .eq("id", invite.scope_id)
        .maybeSingle();
      if (sc) {
        opCo = {
          companyName: sc.company_name,
          abn: sc.abn,
          tradeCategory: sc.trade_category,
          sequenceOrder: sc.sequence_order,
        };
      }
    }

    const expired = new Date(invite.expires_at).getTime() < Date.now();

    return NextResponse.json({
      invite: {
        id: invite.id,
        email: invite.email,
        recipientName: invite.recipient_name,
        roleType: invite.role_type,
        opCoId: invite.scope_id,
        status: expired && invite.status === "pending" ? "expired" : invite.status,
        expiresAt: invite.expires_at,
        job: {
          id: job.id,
          reference: job.reference,
          title: job.title,
          propertyAddress: job.property_address,
          suburbState: job.suburb_state,
          leadSource: job.lead_source,
        },
        opCo,
      },
    });
  } catch (err) {
    console.error("GET /api/cobid/invites/[token] error:", err);
    return NextResponse.json({ error: "Failed to verify invite" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const supabase = createServiceClient();

    const { data: invite } = await supabase
      .from("cobid_invites")
      .select("id, org_id, workspace_id, email, recipient_name, role_type, scope_id, status, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (!invite) {
      return NextResponse.json({ error: "Invite link not found" }, { status: 404 });
    }
    if (invite.status === "revoked") {
      return NextResponse.json({ error: "This invite link has been revoked" }, { status: 410 });
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "This invite link has expired" }, { status: 410 });
    }

    await supabase
      .from("cobid_invites")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invite.id);

    const jwt = await signCobidToken({
      inviteId: invite.id,
      orgId: invite.org_id,
      jobId: invite.role_type === "coordinator" ? undefined : invite.workspace_id,
      email: invite.email,
      name: invite.recipient_name,
      roleType: invite.role_type as "coordinator" | "contractor" | "client",
      opCoId: invite.scope_id ?? undefined,
    });

    await addCobidAuditEvent({
      orgId: invite.org_id,
      workspaceId: invite.workspace_id,
      actor: `${invite.recipient_name} (${invite.role_type})`,
      category: "workspace",
      summary: `Authenticated via magic-link invite (${invite.email}).`,
      restrictedToScopeId: invite.scope_id,
    });

    const res = NextResponse.json({ ok: true, jobId: invite.workspace_id });
    res.headers.set("Set-Cookie", cobidCookieHeader(jwt, isSecureCobidRequest(req)));
    return res;
  } catch (err) {
    console.error("POST /api/cobid/invites/[token] error:", err);
    return NextResponse.json({ error: "Failed to accept invite" }, { status: 500 });
  }
}
