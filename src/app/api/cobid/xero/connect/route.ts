import crypto from "crypto";
import { SignJWT } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { isSecureCobidRequest, resolveCobidSession } from "@/lib/cobid/session";
import { getDirectoryOpCoById, getOpCoByOnboardingToken } from "@/lib/cobid/store";
import {
  COBID_XERO_STATE_COOKIE,
  cobidXeroAuthorizeUrl,
  cobidXeroRedirectUri,
  xeroConfigured,
} from "@/lib/cobid/xero";

function stateSecret(): Uint8Array {
  const s =
    process.env.COBID_SESSION_SECRET ||
    process.env.PORTAL_SESSION_SECRET ||
    process.env.STAFF_SESSION_SECRET ||
    "";
  if (s.length < 32) {
    throw new Error("Session secret must be at least 32 characters");
  }
  return new TextEncoder().encode(s);
}

export async function GET(req: NextRequest) {
  try {
    const onboardingToken = req.nextUrl.searchParams.get("onboardingToken")?.trim() || "";
    const opcoIdParam = req.nextUrl.searchParams.get("opcoId")?.trim() || "";

    let opcoId = "";
    let orgId = "";
    let returnPath = "/cobid";

    if (onboardingToken) {
      const found = await getOpCoByOnboardingToken(onboardingToken);
      if (!found || found.expired) {
        return NextResponse.json({ error: "Invalid or expired onboarding token" }, { status: 403 });
      }
      opcoId = found.opCo.id;
      orgId = found.orgId;
      returnPath = `/cobid/onboard/${encodeURIComponent(onboardingToken)}`;
    } else if (opcoIdParam) {
      const session = await resolveCobidSession(req);
      if (!session || session.roleType !== "coordinator") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const opCo = await getDirectoryOpCoById(session.orgId, opcoIdParam);
      if (!opCo) {
        return NextResponse.json({ error: "OpCo not found" }, { status: 404 });
      }
      opcoId = opCo.id;
      orgId = session.orgId;
      returnPath = "/cobid";
    } else {
      return NextResponse.json(
        { error: "Either onboardingToken or opcoId is required" },
        { status: 400 }
      );
    }

    if (!xeroConfigured()) {
      const fallbackUrl = new URL(returnPath, req.url);
      fallbackUrl.searchParams.set("xero", "not_configured");
      return NextResponse.redirect(fallbackUrl);
    }

    const nonce = crypto.randomBytes(24).toString("hex");
    const signedCookie = await new SignJWT({
      typ: "cobid_xero_state",
      nonce,
      opco_id: opcoId,
      org_id: orgId,
      return_path: returnPath,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(stateSecret());

    const redirectUri = cobidXeroRedirectUri(req);
    const authorizeUrl = cobidXeroAuthorizeUrl(nonce, redirectUri);

    const res = NextResponse.redirect(authorizeUrl);
    res.cookies.set(COBID_XERO_STATE_COOKIE, signedCookie, {
      httpOnly: true,
      secure: isSecureCobidRequest(req),
      sameSite: "lax",
      path: "/api/cobid/xero",
      maxAge: 900,
    });
    return res;
  } catch (err) {
    console.error("GET /api/cobid/xero/connect error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start Xero OAuth" },
      { status: 500 }
    );
  }
}
