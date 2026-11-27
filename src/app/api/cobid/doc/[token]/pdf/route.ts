import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getWorkspaceById, hashCobidToken } from "@/lib/cobid/store";
import { buildAgreementPdf } from "@/lib/cobid/pdf";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    if (!token || token.length < 16) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const supabase = createServiceClient();
    const hash = hashCobidToken(token);
    const { data: scopeRow } = await supabase
      .from("cobid_scopes")
      .select("id, org_id, workspace_id, agreement_ref, monogram")
      .eq("doc_token_hash", hash)
      .maybeSingle();

    if (!scopeRow) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const job = await getWorkspaceById(
      String(scopeRow.org_id),
      String(scopeRow.workspace_id),
      { type: "contractor", opCoId: String(scopeRow.id) },
      req
    );
    const opCo = job?.opCos.find((o) => o.id === String(scopeRow.id));
    if (!job || !opCo) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const pdfBytes = await buildAgreementPdf(job, opCo);
    const filename = `${opCo.independentJobRef || opCo.agreementRef}-${opCo.monogram}.pdf`;
    const inline = req.nextUrl.searchParams.get("inline") === "1";

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("GET /api/cobid/doc/[token]/pdf error:", err);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
