import { NextResponse } from "next/server";
import {
  clearCobidCookieHeader,
  getMagicLinkSession,
  isSecureCobidRequest,
} from "@/lib/cobid/session";
import { clearStaffCookieHeader, isSecureStaffRequest } from "@/lib/staffSession";

export async function POST(req: Request) {
  const magic = await getMagicLinkSession();
  const res = NextResponse.json({ ok: true, cleared: magic ? "magic_link" : "staff" });

  // Always clear bh_cobid cookie. Only clear bh_staff if user was signing out of a staff session.
  res.headers.append("Set-Cookie", clearCobidCookieHeader(isSecureCobidRequest(req)));
  if (!magic) {
    res.headers.append("Set-Cookie", clearStaffCookieHeader(isSecureStaffRequest(req)));
  }
  return res;
}
