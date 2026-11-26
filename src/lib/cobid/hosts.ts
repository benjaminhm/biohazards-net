/*
 * lib/cobid/hosts.ts
 *
 * Host routing config for the Co-Bid co-sharing SaaS module.
 * Defaults to app.hazmatmanagement.com.au; override or add hosts via COBID_HOSTS
 * (comma-separated, e.g. "app.hazmatmanagement.com.au,cobid.hazmatmanagement.com.au").
 */

const DEFAULT_COBID_HOSTS = ["app.hazmatmanagement.com.au"];

export function cobidHosts(): string[] {
  const raw = process.env.COBID_HOSTS?.trim();
  if (!raw) return DEFAULT_COBID_HOSTS;
  const parsed = raw
    .split(/[\s,;]+/)
    .map((h) => h.trim().toLowerCase().split(":")[0])
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_COBID_HOSTS;
}

export function isCobidHost(hostHeader: string | null | undefined): boolean {
  const host = (hostHeader ?? "").split(",")[0].trim().split(":")[0].toLowerCase();
  if (!host) return false;
  return cobidHosts().includes(host);
}

/**
 * Build the public invite URL for an external OpCo or Client.
 * On a dedicated Co-Bid host (e.g. app.hazmatmanagement.com.au), invites live at
 * `/invite/<token>`. On localhost or app.biohazards.net, they live at `/cobid/invite/<token>`.
 */
export function buildCobidInviteUrl(req: Request, token: string): string {
  const hostHeader = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const host = hostHeader.split(",")[0].trim();
  const proto = (req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https"))
    .split(",")[0]
    .trim();

  if (isCobidHost(host)) {
    return `${proto}://${host}/invite/${token}`;
  }

  const configuredPrimary = process.env.NEXT_PUBLIC_COBID_URL?.trim().replace(/\/+$/, "");
  if (configuredPrimary) {
    return `${configuredPrimary}/invite/${token}`;
  }

  if (host) {
    return `${proto}://${host}/cobid/invite/${token}`;
  }

  return `https://${DEFAULT_COBID_HOSTS[0]}/invite/${token}`;
}
