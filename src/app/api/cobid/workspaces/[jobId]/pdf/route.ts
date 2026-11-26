import { NextRequest, NextResponse } from "next/server";
import { resolveCobidSession, sessionToUserRole } from "@/lib/cobid/session";
import { getWorkspaceById } from "@/lib/cobid/store";
import {
  buildAgreementPdf,
  buildCompletionPackPdf,
  buildTaxInvoicePdf,
} from "@/lib/cobid/pdf";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const session = await resolveCobidSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await context.params;
    const type = req.nextUrl.searchParams.get("type") || "completion";
    const opCoId = req.nextUrl.searchParams.get("opCoId");
    const preview = req.nextUrl.searchParams.get("preview") === "1";

    if (session.jobId && session.jobId !== jobId) {
      return NextResponse.json({ error: "Forbidden for this workspace" }, { status: 403 });
    }

    // Strictly enforce commercial ring-fencing for contractor sessions
    if (
      session.roleType === "contractor" &&
      (type === "agreement" || type === "invoice") &&
      opCoId !== session.opCoId
    ) {
      return NextResponse.json(
        { error: "Forbidden: cannot download another OpCo's commercial document" },
        { status: 403 }
      );
    }

    const role = sessionToUserRole(session);
    const job = await getWorkspaceById(session.orgId, jobId, role);

    if (!job) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    let pdfBytes: Uint8Array;
    let filename: string;

    if (type === "agreement") {
      const opCo = job.opCos.find((o) => o.id === opCoId);
      if (!opCo) {
        return NextResponse.json({ error: "OpCo not found" }, { status: 404 });
      }
      pdfBytes = await buildAgreementPdf(job, opCo);
      filename = `${opCo.agreementRef}-${opCo.monogram}-Agreement.pdf`;
    } else if (type === "invoice") {
      const opCo = job.opCos.find((o) => o.id === opCoId);
      if (!opCo) {
        return NextResponse.json({ error: "OpCo not found" }, { status: 404 });
      }
      pdfBytes = await buildTaxInvoicePdf(job, opCo);
      filename = `${opCo.balanceInvoiceRef}-${opCo.monogram}-TaxInvoice.pdf`;
    } else {
      pdfBytes = await buildCompletionPackPdf(job);
      filename = `${job.reference}-Completion-Pack.pdf`;
    }

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("GET /api/cobid/workspaces/[jobId]/pdf error:", err);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
