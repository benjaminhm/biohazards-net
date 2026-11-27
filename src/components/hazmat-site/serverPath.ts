import { headers } from "next/headers";

export async function getHazmatBasePath(): Promise<string> {
  const headerList = await headers();
  if (headerList.get("x-hazmat-site-root") === "1") {
    return "";
  }
  const explicitBase = headerList.get("x-hazmat-site-base");
  if (explicitBase !== null) {
    return explicitBase;
  }
  return "/hazmat-site";
}
