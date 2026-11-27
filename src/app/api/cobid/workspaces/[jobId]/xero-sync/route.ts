import { NextRequest, NextResponse } from "next/server";
import { resolveCobidSession } from "@/lib/cobid/session";
import { getWorkspaceById } from "@/lib/cobid/store";
import {
  raiseOpCoXeroInvoice,
  syncWorkspaceXeroPayments,
} from "@/lib/cobid/xero";

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
      return NextResponse.json({ error: "Only coordinators can trigger Xero sync" }, { status: 403 });
    }

    const { jobId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "sync");

    if (action === "raise_invoice") {
      const opCoId = String(body?.opCoId || "");
      const kind = body?.kind === "balance" ? "balance" : "deposit";
      if (!opCoId) {
        return NextResponse.json({ error: "opCoId is required" }, { status: 400 });
      }
      const invoiceResult = await raiseOpCoXeroInvoice(opCoId, kind);
      const job = await getWorkspaceById(session.orgId, jobId, { type: "coordinator" }, req);
      return NextResponse.json({ invoiceResult, job });
    }

    const syncResults = await syncWorkspaceXeroPayments(session.orgId, jobId);
    const job = await getWorkspaceById(session.orgId, jobId, { type: "coordinator" }, req);
    return NextResponse.json({ syncResults, job });
  } catch (err) {
    console.error("POST /api/cobid/workspaces/[jobId]/xero-sync error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Xero sync failed" },
      { status: 500 }
    );
  }
}
