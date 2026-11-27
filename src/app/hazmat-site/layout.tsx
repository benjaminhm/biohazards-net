import "./hazmat.css";
import SiteShell from "@/components/hazmat-site/SiteShell";
import { getHazmatBasePath } from "@/components/hazmat-site/serverPath";

export default async function HazmatSiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const basePath = await getHazmatBasePath();

  return (
    <div className="hazmat-root">
      <SiteShell basePath={basePath}>{children}</SiteShell>
    </div>
  );
}
