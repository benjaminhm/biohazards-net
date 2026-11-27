/*
 * lib/cobid/hosts.ts
 *
 * Host routing config for HAZMAT Management / Co-Bid:
 *  - Public institutional site host (HAZMAT_SITE_HOSTS, default hazmatmanagement.com.au, www.hazmatmanagement.com.au)
 *  - App host (COBID_HOSTS, default app.hazmatmanagement.com.au)
 *  - Independent entity client documents host (COBID_DOCS_HOSTS, default docs.hazmatmanagement.com.au)
 */

const DEFAULT_HAZMAT_SITE_HOSTS = [
  "hazmatmanagement.com.au",
  "www.hazmatmanagement.com.au",
];
const DEFAULT_COBID_HOSTS = ["app.hazmatmanagement.com.au"];
const DEFAULT_COBID_DOCS_HOSTS = ["docs.hazmatmanagement.com.au"];

function parseHostList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw?.trim()) return fallback;
  const parsed = raw
    .split(/[\s,;]+/)
    .map((h) => h.trim().toLowerCase().split(":")[0])
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

export function hazmatSiteHosts(): string[] {
  return parseHostList(process.env.HAZMAT_SITE_HOSTS, DEFAULT_HAZMAT_SITE_HOSTS);
}

export function isHazmatSiteHost(hostHeader: string | null | undefined): boolean {
  const host = (hostHeader ?? "").split(",")[0].trim().split(":")[0].toLowerCase();
  if (!host) return false;
  return hazmatSiteHosts().includes(host);
}

export function cobidHosts(): string[] {
  return parseHostList(process.env.COBID_HOSTS, DEFAULT_COBID_HOSTS);
}

export function isCobidHost(hostHeader: string | null | undefined): boolean {
  const host = (hostHeader ?? "").split(",")[0].trim().split(":")[0].toLowerCase();
  if (!host) return false;
  return cobidHosts().includes(host);
}

export function cobidDocsHosts(): string[] {
  return parseHostList(process.env.COBID_DOCS_HOSTS, DEFAULT_COBID_DOCS_HOSTS);
}

export function isCobidDocsHost(hostHeader: string | null | undefined): boolean {
  const host = (hostHeader ?? "").split(",")[0].trim().split(":")[0].toLowerCase();
  if (!host) return false;
  return cobidDocsHosts().includes(host);
}

function requestOrigin(req: Request): { host: string; proto: string } {
  const hostHeader = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const host = hostHeader.split(",")[0].trim();
  const isLocal =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("0.0.0.0");
  const proto = (req.headers.get("x-forwarded-proto") ?? (isLocal ? "http" : "https"))
    .split(",")[0]
    .trim();
  return { host, proto };
}

function buildAppScopedUrl(req: Request, shortPath: string, cobidPrefixedPath: string): string {
  const { host, proto } = requestOrigin(req);

  if (isCobidHost(host)) {
    return `${proto}://${host}${shortPath}`;
  }

  const configuredPrimary = process.env.NEXT_PUBLIC_COBID_URL?.trim().replace(/\/+$/, "");
  if (configuredPrimary) {
    return `${configuredPrimary}${shortPath}`;
  }

  if (host) {
    return `${proto}://${host}${cobidPrefixedPath}`;
  }

  return `https://${DEFAULT_COBID_HOSTS[0]}${shortPath}`;
}

export function buildCobidInviteUrl(req: Request, token: string): string {
  return buildAppScopedUrl(req, `/invite/${token}`, `/cobid/invite/${token}`);
}

export function buildCobidOnboardUrl(req: Request, token: string): string {
  return buildAppScopedUrl(req, `/onboard/${token}`, `/cobid/onboard/${token}`);
}

export function buildCobidBidUrl(req: Request, token: string): string {
  return buildAppScopedUrl(req, `/bid/${token}`, `/cobid/bid/${token}`);
}

/**
 * Independent OpCo client document URL on docs.hazmatmanagement.com.au (or /cobid/doc/<token>
 * when NEXT_PUBLIC_COBID_DOCS_URL is unset and running on localhost / biohazards.net).
 */
export function buildCobidDocUrl(req: Request, token: string): string {
  const configuredDocs = process.env.NEXT_PUBLIC_COBID_DOCS_URL?.trim().replace(/\/+$/, "");
  if (configuredDocs) {
    return `${configuredDocs}/${token}`;
  }
  const { host, proto } = requestOrigin(req);
  if (isCobidDocsHost(host)) {
    return `${proto}://${host}/${token}`;
  }
  if (host) {
    return `${proto}://${host}/cobid/doc/${token}`;
  }
  return `https://${DEFAULT_COBID_DOCS_HOSTS[0]}/${token}`;
}

/**
 * Coordinated package index URL listing each independent company's separate document link.
 */
export function buildCobidPackageUrl(req: Request, token: string): string {
  const configuredDocs = process.env.NEXT_PUBLIC_COBID_DOCS_URL?.trim().replace(/\/+$/, "");
  if (configuredDocs) {
    return `${configuredDocs}/pkg/${token}`;
  }
  const { host, proto } = requestOrigin(req);
  if (isCobidDocsHost(host)) {
    return `${proto}://${host}/pkg/${token}`;
  }
  if (host) {
    return `${proto}://${host}/cobid/pkg/${token}`;
  }
  return `https://${DEFAULT_COBID_DOCS_HOSTS[0]}/pkg/${token}`;
}
