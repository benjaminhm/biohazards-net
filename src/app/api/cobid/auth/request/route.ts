import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { clientIpFromRequest, userAgentFromRequest } from "@/lib/portalAuth";
import { sendStaffMagicLinkEmail } from "@/lib/portal/email";
import { issueStaffLogin, supabaseStaffTokenStore } from "@/lib/staffLogin";
import { lookupStaffIdentityByEmail } from "@/lib/staffIdentity";
import { isCobidHost } from "@/lib/cobid/hosts";
import { isDevHost } from "@/lib/staffSession";

function resolveCobidAuthOrigin(req: Request): string {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "")
    .split(",")[0]
    .trim();
  const proto = (req.headers.get("x-forwarded-proto") ?? (isDevHost(host) ? "http" : "https"))
    .split(",")[0]
    .trim();

  if (host && (isCobidHost(host) || isDevHost(host) || host.endsWith(".vercel.app"))) {
    return `${proto}://${host}`;
  }

  const configured = process.env.NEXT_PUBLIC_COBID_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return "https://app.hazmatmanagement.com.au";
}

const GENERIC_OK = {
  ok: true,
  message: "If that coordinator email can sign in, a magic link is on its way.",
};

export async function POST(req: Request) {
  let email = "";
  try {
    const body = await req.json();
    email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const issued = await issueStaffLogin(
    supabaseStaffTokenStore(supabase),
    email,
    clientIpFromRequest(req),
    userAgentFromRequest(req),
    lookupStaffIdentityByEmail
  );

  if (issued.status === "limited") {
    return NextResponse.json(
      { error: "Too many sign-in requests. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  if (issued.status === "issued") {
    const origin = resolveCobidAuthOrigin(req);
    try {
      await sendStaffMagicLinkEmail({
        to: issued.email,
        loginUrl: `${origin}/login/${issued.token}`,
        expiresInMinutes: issued.ttlMinutes,
      });
    } catch (err) {
      console.error("[cobid-staff-magic-link] send failed", err);
    }
  }

  return NextResponse.json(GENERIC_OK);
}
