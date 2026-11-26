/*
 * lib/cobid/session.ts
 *
 * Dual authentication for Co-Bid:
 *  1. External OpCos & Clients authenticate via a signed httpOnly JWT cookie
 *     (`bh_cobid`, HS256, typ: "bh_cobid") issued upon accepting a magic-link invite.
 *  2. Internal Coordinators authenticate via biohazards-net's existing `bh_staff`
 *     session (`lib/staffAuth.ts` + `lib/org.ts`).
 *
 * If a `bh_cobid` magic-link cookie is present, it takes precedence so invited
 * parties (and coordinators testing a magic link in the same browser) are
 * strictly locked to that invite's role and ring-fenced OpCo scope until Sign Out.
 */
import crypto from "crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { auth } from "@/lib/staffAuth";
import { getOrgId } from "@/lib/org";
import { getStaffSessionFromRequest, isDevHost } from "@/lib/staffSession";
import { staffDisplayName } from "@/lib/staffLogin";
import { createServiceClient } from "@/lib/supabase";
import type { CobidSessionInfo, UserRole } from "./types";

export const COBID_COOKIE = "bh_cobid";
const JWT_TYP = "bh_cobid";
export const COBID_SESSION_DAYS = 7;
export const COBID_SESSION_MAX_AGE = COBID_SESSION_DAYS * 24 * 60 * 60;

function getSecretKey(): Uint8Array {
  const s =
    process.env.COBID_SESSION_SECRET ||
    process.env.PORTAL_SESSION_SECRET ||
    process.env.STAFF_SESSION_SECRET ||
    "";
  if (s.length < 32) {
    throw new Error(
      "COBID_SESSION_SECRET (or PORTAL_SESSION_SECRET / STAFF_SESSION_SECRET) must be at least 32 characters"
    );
  }
  return new TextEncoder().encode(s);
}

function getSecretKeyOptional(): Uint8Array | null {
  const s =
    process.env.COBID_SESSION_SECRET ||
    process.env.PORTAL_SESSION_SECRET ||
    process.env.STAFF_SESSION_SECRET ||
    "";
  if (s.length < 32) return null;
  return new TextEncoder().encode(s);
}

export function generateCobidToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export interface CobidMagicClaims {
  inviteId: string;
  orgId: string;
  jobId?: string;
  email: string;
  name: string;
  roleType: "coordinator" | "contractor" | "client";
  opCoId?: string;
}

export async function signCobidToken(claims: CobidMagicClaims): Promise<string> {
  const secret = getSecretKey();
  return new SignJWT({
    typ: JWT_TYP,
    org_id: claims.orgId,
    job_id: claims.jobId ?? null,
    email: claims.email,
    name: claims.name,
    role_type: claims.roleType,
    opco_id: claims.opCoId ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.inviteId)
    .setIssuedAt()
    .setExpirationTime(`${COBID_SESSION_DAYS}d`)
    .sign(secret);
}

export async function verifyCobidToken(
  token: string
): Promise<(CobidMagicClaims & { expiresAt?: string }) | null> {
  const secret = getSecretKeyOptional();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.typ !== JWT_TYP) return null;
    const inviteId = payload.sub;
    const orgId = payload.org_id as string | undefined;
    const email = payload.email as string | undefined;
    const name = payload.name as string | undefined;
    const roleType = payload.role_type as CobidMagicClaims["roleType"] | undefined;
    if (!inviteId || !orgId || !email || !name || !roleType) return null;
    if (roleType !== "coordinator" && roleType !== "contractor" && roleType !== "client") {
      return null;
    }
    return {
      inviteId,
      orgId,
      jobId: typeof payload.job_id === "string" && payload.job_id ? payload.job_id : undefined,
      email,
      name,
      roleType,
      opCoId: typeof payload.opco_id === "string" && payload.opco_id ? payload.opco_id : undefined,
      expiresAt: typeof payload.exp === "number" ? new Date(payload.exp * 1000).toISOString() : undefined,
    };
  } catch {
    return null;
  }
}

export function isSecureCobidRequest(req: Request): boolean {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return !isDevHost(host);
}

export function cobidCookieHeader(token: string, secure: boolean): string {
  const expires = new Date(Date.now() + COBID_SESSION_MAX_AGE * 1000).toUTCString();
  const parts = [
    `${COBID_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COBID_SESSION_MAX_AGE}`,
    `Expires=${expires}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCobidCookieHeader(secure: boolean): string {
  const parts = [
    `${COBID_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export async function getMagicLinkSession(): Promise<CobidSessionInfo | null> {
  const jar = await cookies();
  const raw = jar.get(COBID_COOKIE)?.value;
  if (!raw) return null;
  const claims = await verifyCobidToken(raw);
  if (!claims) return null;

  // Verify the invite hasn't been revoked since the cookie was issued
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("cobid_invites")
      .select("status")
      .eq("id", claims.inviteId)
      .maybeSingle();
    if (data?.status === "revoked") return null;
  } catch {
    // Allow if table check fails transiently; claims are still signed.
  }

  return {
    source: "magic_link",
    email: claims.email,
    name: claims.name,
    roleType: claims.roleType,
    opCoId: claims.opCoId,
    jobId: claims.jobId,
    orgId: claims.orgId,
    expiresAt: claims.expiresAt,
  };
}

/**
 * Resolve the active Co-Bid session from either:
 *  - `bh_cobid` magic-link cookie (external OpCo / Client / locked invite), OR
 *  - `bh_staff` coordinator session (authenticated staff member).
 */
export async function resolveCobidSession(req: Request): Promise<CobidSessionInfo | null> {
  const magic = await getMagicLinkSession();
  if (magic) return magic;

  const { userId } = await auth();
  if (!userId) return null;

  const { orgId } = await getOrgId(req, userId);
  if (!orgId) return null;

  const staffToken = await getStaffSessionFromRequest(req);
  const email = staffToken?.email ?? "";
  const name = staffDisplayName();

  return {
    source: "staff",
    email,
    name: `${name} (Scoping Desk)`,
    roleType: "coordinator",
    orgId,
  };
}

export function sessionToUserRole(session: CobidSessionInfo): UserRole {
  if (session.roleType === "contractor" && session.opCoId) {
    return { type: "contractor", opCoId: session.opCoId };
  }
  if (session.roleType === "client") {
    return { type: "client" };
  }
  return { type: "coordinator" };
}
