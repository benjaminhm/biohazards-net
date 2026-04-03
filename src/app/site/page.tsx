/*
 * app/site/page.tsx
 *
 * Public company website — served at companyname.biohazards.net
 * Middleware rewrites companyname.biohazards.net/* → /site/* and sets
 * x-org-slug header so this page knows which company to render.
 *
 * Fetches public company profile from /api/public/[slug].
 * No authentication required — fully public, Google indexed.
 *
 * TODO: Build full website template (hero, services, about, contact, lead capture)
 * For now renders a placeholder so the routing is confirmed working.
 */
import { headers } from 'next/headers'

async function getCompany(slug: string) {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/public/${slug}`,
      { next: { revalidate: 60 } }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.company ?? null
  } catch { return null }
}

export default async function SitePage() {
  const headersList = await headers()
  const slug = headersList.get('x-org-slug') ?? ''
  const company = await getCompany(slug)

  if (!company) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>☣</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Company not found</h1>
          <p style={{ color: '#666' }}>This page doesn&apos;t exist yet.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', fontFamily: 'sans-serif', background: '#fff' }}>
      {/* Placeholder — full website template coming soon */}
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 64, marginBottom: 24 }}>☣</div>
        <h1 style={{ fontSize: 36, fontWeight: 800, marginBottom: 12 }}>{company.name}</h1>
        {company.phone && (
          <a href={`tel:${company.phone}`} style={{ fontSize: 20, color: '#FF6B35', fontWeight: 700, textDecoration: 'none', display: 'block', marginBottom: 8 }}>
            {company.phone}
          </a>
        )}
        {company.email && (
          <a href={`mailto:${company.email}`} style={{ fontSize: 16, color: '#666', textDecoration: 'none' }}>
            {company.email}
          </a>
        )}
        <p style={{ marginTop: 48, fontSize: 13, color: '#999' }}>
          Powered by <a href="https://biohazards.net" style={{ color: '#FF6B35', textDecoration: 'none' }}>biohazards.net</a>
        </p>
      </div>
    </div>
  )
}
