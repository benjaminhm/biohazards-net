import { NextRequest, NextResponse } from "next/server";
import { resolveCobidSession } from "@/lib/cobid/session";
import {
  reissueOpCoOnboardingToken,
  reviewDirectoryOpCo,
  reviewOpCoComplianceDoc,
} from "@/lib/cobid/store";
import { buildCobidOnboardUrl } from "@/lib/cobid/hosts";
import { sendCobidOnboardingEmail } from "@/lib/cobid/email";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ opcoId: string }> }
) {
  try {
    const session = await resolveCobidSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.roleType !== "coordinator") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { opcoId } = await context.params;
    const body = await req.json();
    const action = String(body?.action ?? "");

    if (action === "approve" || action === "request_changes" || action === "suspend") {
      const opCo = await reviewDirectoryOpCo(
        session.orgId,
        opcoId,
        session.name,
        action,
        typeof body?.notes === "string" ? body.notes : undefined
      );
      return NextResponse.json({ opCo });
    }

    if (action === "verify_doc" || action === "reject_doc") {
      const docId = String(body?.docId ?? "");
      if (!docId) {
        return NextResponse.json({ error: "docId is required" }, { status: 400 });
      }
      const opCo = await reviewOpCoComplianceDoc(
        session.orgId,
        opcoId,
        docId,
        session.name,
        action === "verify_doc" ? "verify" : "reject",
        typeof body?.reason === "string" ? body.reason : undefined
      );
      return NextResponse.json({ opCo });
    }

    if (action === "resend_onboarding_link") {
      const { opCo, token } = await reissueOpCoOnboardingToken(session.orgId, opcoId);
      const onboardingUrl = buildCobidOnboardUrl(req, token);
      let emailSent = false;
      let emailError: string | undefined;
      if (opCo.contactEmail) {
        const res = await sendCobidOnboardingEmail({
          to: opCo.contactEmail,
          contactName: opCo.contactName || opCo.companyName,
          companyName: opCo.companyName,
          tradeCategory: opCo.tradeCategory,
          onboardingUrl,
        });
        emailSent = res.sent;
        emailError = res.error;
      }
      return NextResponse.json({ opCo, onboardingUrl, emailSent, emailError });
    }

    return NextResponse.json({ error: `Unknown review action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error("POST /api/cobid/opcos/[opcoId]/review error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to review operator" },
      { status: 500 }
    );
  }
}
