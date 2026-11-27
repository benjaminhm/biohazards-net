import { NextRequest, NextResponse } from "next/server";
import { resolveCobidSession } from "@/lib/cobid/session";
import { createOpCoOnboardingInvite } from "@/lib/cobid/store";
import { buildCobidOnboardUrl } from "@/lib/cobid/hosts";
import { sendCobidOnboardingEmail } from "@/lib/cobid/email";

export async function POST(req: NextRequest) {
  try {
    const session = await resolveCobidSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.roleType !== "coordinator") {
      return NextResponse.json({ error: "Only coordinators can invite operators" }, { status: 403 });
    }

    const body = await req.json();
    const companyName = String(body?.companyName ?? "").trim();
    const tradeCategory = String(body?.tradeCategory ?? "").trim();
    const contactEmail = String(body?.contactEmail ?? "").trim().toLowerCase();
    const contactName = String(body?.contactName ?? "").trim();
    const phone = String(body?.phone ?? "").trim();
    const allowedQuoteTypes = Array.isArray(body?.allowedQuoteTypes)
      ? body.allowedQuoteTypes
      : undefined;

    if (!companyName || !tradeCategory || !contactEmail) {
      return NextResponse.json(
        { error: "companyName, tradeCategory, and contactEmail are required" },
        { status: 400 }
      );
    }

    const { opCo, token } = await createOpCoOnboardingInvite(session.orgId, {
      companyName,
      tradeCategory,
      contactName,
      contactEmail,
      phone,
      allowedQuoteTypes,
    });

    const onboardingUrl = buildCobidOnboardUrl(req, token);
    const emailResult = await sendCobidOnboardingEmail({
      to: contactEmail,
      contactName: contactName || companyName,
      companyName,
      tradeCategory,
      onboardingUrl,
    });

    return NextResponse.json(
      {
        opCo,
        onboardingUrl,
        emailSent: emailResult.sent,
        emailError: emailResult.error,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/cobid/opcos/invite error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to invite operator" },
      { status: 500 }
    );
  }
}
