import { timingSafeEqual } from "crypto";
import { jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";
import {
  COBID_XERO_STATE_COOKIE,
  cobidXeroRedirectUri,
  completeOpCoXeroConnection,
} from "@/lib/cobid/xero";

function stateSecret(): Uint8Array {
  const s =
    process.env.COBID_SESSION_SECRET ||
    process.env.PORTAL_SESSION_SECRET ||
    process.env.STAFF_SESSION_SECRET ||
    "";
  return new TextEncoder().encode(s);
}

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: NextRequest) {
  let returnPath = "/cobid";

  const redirectBack = (status: string, extra?: Record<string, string>) => {
    const target = new URL(returnPath, req.url);
    target.searchParams.set("xero", status);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        target.searchParams.set(k, v.slice(0, 200));
      }
    }
    const res = NextResponse.redirect(target);
    res.cookies.set(COBID_XERO_STATE_COOKIE, "", {
      path: "/api/cobid/xero",
      maxAge: 0,
    });
    return res;
  };

  try {
    const rawCookie = req.cookies.get(COBID_XERO_STATE_COOKIE)?.value || "";
    if (!rawCookie) {
      return redirectBack("error", { reason: "Xero connection session expired, please try again" });
    }

    const { payload } = await jwtVerify(rawCookie, stateSecret());
    if (payload.typ !== "cobid_xero_state") {
      return redirectBack("error", { reason: "Invalid OAuth state" });
    }

    const expectedNonce = String(payload.nonce || "");
    const opcoId = String(payload.opco_id || "");
    const orgId = String(payload.org_id || "");
    if (typeof payload.return_path === "string" && payload.return_path.startsWith("/")) {
      returnPath = payload.return_path;
    }

    const errParam = req.nextUrl.searchParams.get("error");
    if (errParam) {
      return redirectBack("error", { reason: errParam });
    }

    const stateParam = req.nextUrl.searchParams.get("state") || "";
    if (!stateParam || !expectedNonce || !sameString(stateParam, expectedNonce)) {
      return redirectBack("error", { reason: "State mismatch — please retry Xero connection" });
    }

    const code = req.nextUrl.searchParams.get("code") || "";
    if (!code || !opcoId || !orgId) {
      return redirectBack("error", { reason: "Xero did not return an authorisation code" });
    }

    const result = await completeOpCoXeroConnection(
      opcoId,
      orgId,
      code,
      cobidXeroRedirectUri(req)
    );

    return redirectBack("connected", { tenant: result.tenantName });
  } catch (err) {
    console.error("GET /api/cobid/xero/callback error:", err);
    return redirectBack("error", {
      reason: err instanceof Error ? err.message : "Xero connection failed",
    });
  }
}
