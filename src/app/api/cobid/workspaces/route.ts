import { NextRequest, NextResponse } from "next/server";
import { resolveCobidSession, sessionToUserRole } from "@/lib/cobid/session";
import { createWorkspace, listDirectoryOpCos, listWorkspaces } from "@/lib/cobid/store";
import type { UserRole } from "@/lib/cobid/types";

function parsePreviewRole(req: NextRequest): UserRole | undefined {
  const roleType = req.nextUrl.searchParams.get("role");
  const opCoId = req.nextUrl.searchParams.get("opCoId");
  if (roleType === "contractor" && opCoId) {
    return { type: "contractor", opCoId };
  }
  if (roleType === "client") return { type: "client" };
  if (roleType === "coordinator") return { type: "coordinator" };
  return undefined;
}

export async function GET(req: NextRequest) {
  try {
    const session = await resolveCobidSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized", jobs: [], session: null }, { status: 401 });
    }

    // Magic-link sessions are strictly locked to their invited role & workspace.
    // Authenticated staff coordinators may optionally preview another perspective.
    const role: UserRole =
      session.source === "magic_link"
        ? sessionToUserRole(session)
        : parsePreviewRole(req) ?? { type: "coordinator" };

    const jobs = await listWorkspaces(session.orgId, {
      workspaceId: session.jobId,
      role,
    });

    const directory =
      session.roleType === "coordinator" ? await listDirectoryOpCos(session.orgId) : [];

    return NextResponse.json({ jobs, session, directory });
  } catch (err) {
    console.error("GET /api/cobid/workspaces error:", err);
    return NextResponse.json(
      { error: "Failed to load Co-Bid workspaces" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await resolveCobidSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.roleType !== "coordinator") {
      return NextResponse.json(
        { error: "Only coordinators can create workspaces" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const selectedOpCoKeys: string[] = Array.isArray(body.selectedOpCoKeys)
      ? body.selectedOpCoKeys
      : [];

    if (!body.propertyAddress?.trim() || !body.clientName?.trim() || selectedOpCoKeys.length === 0) {
      return NextResponse.json(
        { error: "propertyAddress, clientName, and at least one OpCo are required" },
        { status: 400 }
      );
    }

    const job = await createWorkspace(session.orgId, {
      title: body.title,
      propertyAddress: body.propertyAddress,
      suburbState: body.suburbState,
      clientName: body.clientName,
      clientRole: body.clientRole,
      clientEmail: body.clientEmail,
      clientPhone: body.clientPhone,
      leadSource: body.leadSource,
      leadSourceType: body.leadSourceType,
      settlementRail: body.settlementRail,
      siteAccessNotes: body.siteAccessNotes,
      coordinatorName: session.name,
      selectedOpCoKeys,
    });

    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    console.error("POST /api/cobid/workspaces error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create workspace" },
      { status: 500 }
    );
  }
}
