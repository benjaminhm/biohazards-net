/*
 * lib/websiteLaunchReadiness.ts
 *
 * Single source for “can we launch the public site?” — mirrors Settings → Public Website checklist.
 */

export interface LaunchCheckItem {
  label: string
  ok: boolean
}

/** Build checklist from GET /api/company row (services / areas_served are string arrays). */
export function getPublicWebsiteLaunchChecks(company: Record<string, unknown> | null): LaunchCheckItem[] {
  const name = String(company?.name ?? '').trim()
  const phone = String(company?.phone ?? '').trim()
  const email = String(company?.email ?? '').trim()
  const tagline = String(company?.tagline ?? '').trim()
  const services = company?.services
  const areas = company?.areas_served
  const servicesOk =
    Array.isArray(services) &&
    services.some(s => String(s).trim().length > 0)
  const areasOk =
    Array.isArray(areas) &&
    areas.some(a => String(a).trim().length > 0)

  return [
    { label: 'Company name', ok: name.length > 0 },
    { label: 'Phone number', ok: phone.length > 0 },
    { label: 'Email address', ok: email.length > 0 },
    { label: 'Tagline', ok: tagline.length > 0 },
    { label: 'Services', ok: servicesOk },
    { label: 'Areas served', ok: areasOk },
  ]
}

export function isPublicWebsiteLaunchReady(checks: LaunchCheckItem[]): boolean {
  return checks.every(c => c.ok)
}
