export type HazmatRoute =
  | ""
  | "/how-it-works"
  | "/governance"
  | "/operators"
  | "/about";

export const HAZMAT_NAV_ITEMS: Array<{
  route: HazmatRoute;
  label: string;
  shortLabel: string;
}> = [
  { route: "", label: "Overview", shortLabel: "Overview" },
  { route: "/how-it-works", label: "How It Works", shortLabel: "How It Works" },
  { route: "/governance", label: "Governance", shortLabel: "Governance" },
  { route: "/operators", label: "Independent Operators", shortLabel: "Operators" },
  { route: "/about", label: "About & Contact", shortLabel: "About" },
];

export function hazmatHref(basePath: string, route: HazmatRoute): string {
  const cleanBase = basePath.replace(/\/+$/, "");
  if (!cleanBase) {
    return route === "" ? "/" : route;
  }
  return route === "" ? cleanBase : `${cleanBase}${route}`;
}

export function isActiveHazmatRoute(
  pathname: string | null,
  basePath: string,
  route: HazmatRoute,
): boolean {
  if (!pathname) return false;
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const target = hazmatHref(basePath, route);
  if (normalized === target) return true;
  const fallback = route === "" ? "/hazmat-site" : `/hazmat-site${route}`;
  return normalized === fallback;
}
