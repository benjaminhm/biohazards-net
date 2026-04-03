/*
 * app/site/page.tsx
 *
 * Public company website — served at companyname.biohazards.net
 * Middleware rewrites companyname.biohazards.net/* → /site/* and sets
 * x-org-slug so this page knows which company to render.
 *
 * Server component (SSR + 60s revalidation) for SEO.
 * CallbackForm is a client component for the interactive callback section.
 *
 * Layout order mirrors the BBC website structure:
 *   1. Nav — company name + phone
 *   2. Hero — tagline + emergency CTA + trust strip
 *   3. Services grid
 *   4. 3-step process
 *   5. Areas served
 *   6. Callback form (client component)
 *   7. Footer
 *
 * All data comes from /api/public/[slug] — safe public fields only.
 * If website_live is false, renders a "coming soon" holding page.
 */
import { headers } from 'next/headers'
import CallbackForm from './CallbackForm'

interface Company {
  slug: string
  name: string
  phone: string | null
  email: string | null
  abn: string | null
  logo_url: string | null
  tagline: string | null
  services: string[] | null
  areas_served: string[] | null
  website_live: boolean
}

const DEFAULT_SERVICES = [
  'Biohazard Cleaning',
  'Crime Scene & Trauma Cleanup',
  'Unattended Death Restoration',
  'Forensic Cleaning',
  'Sewage Cleaning',
  'Needle & Syringe Removal',
]

const TRUST_SIGNALS = [
  { icon: '✓', text: 'Fully Insured & Licensed' },
  { icon: '✓', text: 'Discreet Unmarked Vehicles' },
  { icon: '✓', text: '24/7 Emergency Response' },
  { icon: '✓', text: 'IICRC Certified Technicians' },
]

const PROCESS_STEPS = [
  {
    num: '01',
    title: '24/7 Phone Support',
    body: 'Compassionate assessment of your situation. We coordinate the right team immediately.',
  },
  {
    num: '02',
    title: 'Secure the Scene',
    body: 'Discreet unmarked vehicle arrival. Full damage assessment and hazard isolation.',
  },
  {
    num: '03',
    title: 'Complete Restoration',
    body: 'Pathogen eradication, sanitisation, deodorisation. Site returned to safe condition.',
  },
]

async function getCompany(slug: string): Promise<Company | null> {
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

  // Company not found
  if (!company) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif', background: '#fff' }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>☣</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: '#111' }}>Page not found</h1>
          <p style={{ color: '#666' }}>This company website doesn&apos;t exist yet.</p>
        </div>
      </div>
    )
  }

  // Website not yet launched — holding page
  if (!company.website_live) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif', background: '#0A0A0A', color: '#fff' }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 20 }}>☣</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>{company.name}</h1>
          <p style={{ color: '#888', marginBottom: 24 }}>Website coming soon.</p>
          {company.phone && (
            <a href={`tel:${company.phone}`} style={{ display: 'inline-block', padding: '14px 28px', background: '#FF6B35', color: '#fff', textDecoration: 'none', borderRadius: 8, fontWeight: 700, fontSize: 16 }}>
              Call {company.phone}
            </a>
          )}
        </div>
      </div>
    )
  }

  const services = company.services ?? DEFAULT_SERVICES
  const areas = company.areas_served ?? []

  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', color: '#1a1a1a', background: '#fff' }}>

      {/* ── Navigation ── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: '#111', borderBottom: '1px solid rgba(255,255,255,0.08)',
        padding: '0 24px',
      }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: '#fff', letterSpacing: '-0.02em' }}>
            {company.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <a href="#contact" style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', textDecoration: 'none', fontWeight: 500 }}>
              Contact
            </a>
            {company.phone && (
              <a
                href={`tel:${company.phone}`}
                style={{
                  padding: '9px 18px', background: '#FF6B35', color: '#fff',
                  textDecoration: 'none', borderRadius: 8,
                  fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap',
                }}
              >
                {company.phone}
              </a>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{
        background: 'linear-gradient(135deg, #0A0A0A 0%, #1a1a1a 100%)',
        padding: '80px 24px 72px',
        color: '#fff',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
          <div style={{
            display: 'inline-block', padding: '5px 14px',
            background: 'rgba(255,107,53,0.15)', border: '1px solid rgba(255,107,53,0.3)',
            borderRadius: 99, fontSize: 12, fontWeight: 700,
            color: '#FF6B35', letterSpacing: '0.08em', textTransform: 'uppercase',
            marginBottom: 24,
          }}>
            24/7 Emergency Response
          </div>

          <h1 style={{
            fontSize: 'clamp(32px, 5vw, 52px)',
            fontWeight: 900, lineHeight: 1.1,
            letterSpacing: '-0.03em', marginBottom: 20,
          }}>
            {company.tagline ?? `${company.name}: Discreet & Expert Restorations`}
          </h1>

          <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.65)', lineHeight: 1.6, marginBottom: 36, maxWidth: 560, margin: '0 auto 36px' }}>
            Safe, compliant biohazard and trauma cleanup. Certified experts. Empathetic support available across the region 24/7.
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {company.phone && (
              <a
                href={`tel:${company.phone}`}
                style={{
                  padding: '16px 32px', background: '#FF6B35', color: '#fff',
                  textDecoration: 'none', borderRadius: 10,
                  fontWeight: 800, fontSize: 17,
                  boxShadow: '0 4px 24px rgba(255,107,53,0.4)',
                }}
              >
                Get Immediate Help — {company.phone}
              </a>
            )}
            <a
              href="#contact"
              style={{
                padding: '16px 28px',
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff', textDecoration: 'none',
                borderRadius: 10, fontWeight: 600, fontSize: 16,
              }}
            >
              Request Callback
            </a>
          </div>
        </div>
      </section>

      {/* ── Trust signal strip ── */}
      <div style={{ background: '#FF6B35', padding: '16px 24px' }}>
        <div style={{
          maxWidth: 1080, margin: '0 auto',
          display: 'flex', gap: 32, justifyContent: 'center',
          flexWrap: 'wrap',
        }}>
          {TRUST_SIGNALS.map(t => (
            <div key={t.text} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontSize: 14, fontWeight: 600 }}>
              <span style={{ fontSize: 16 }}>{t.icon}</span>
              {t.text}
            </div>
          ))}
        </div>
      </div>

      {/* ── Services ── */}
      <section style={{ padding: '72px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#FF6B35', marginBottom: 12 }}>
              Services
            </div>
            <h2 style={{ fontSize: 'clamp(26px, 4vw, 38px)', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
              What We Do
            </h2>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
          }}>
            {services.map((service: string) => (
              <div key={service} style={{
                padding: '24px', borderRadius: 12,
                border: '1px solid #e8e8e8',
                background: '#fafafa',
                display: 'flex', alignItems: 'flex-start', gap: 14,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: 'rgba(255,107,53,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, flexShrink: 0,
                }}>
                  ☣
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{service}</div>
                  <div style={{ fontSize: 13, color: '#888', lineHeight: 1.5 }}>
                    Professional, compliant, and discreet.
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 3-step process ── */}
      <section style={{ padding: '72px 24px', background: '#0A0A0A', color: '#fff' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#FF6B35', marginBottom: 12 }}>
              How It Works
            </div>
            <h2 style={{ fontSize: 'clamp(26px, 4vw, 38px)', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
              Our Process
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 24 }}>
            {PROCESS_STEPS.map(step => (
              <div key={step.num} style={{ padding: 28, borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: 36, fontWeight: 900, color: '#FF6B35', letterSpacing: '-0.04em', marginBottom: 16, opacity: 0.8 }}>
                  {step.num}
                </div>
                <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 10 }}>{step.title}</div>
                <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>{step.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Areas served ── */}
      {areas.length > 0 && (
        <section style={{ padding: '72px 24px', background: '#fff' }}>
          <div style={{ maxWidth: 1080, margin: '0 auto', textAlign: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#FF6B35', marginBottom: 12 }}>
              Coverage
            </div>
            <h2 style={{ fontSize: 'clamp(26px, 4vw, 38px)', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 36 }}>
              Areas We Serve
            </h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
              {areas.map((area: string) => (
                <div key={area} style={{
                  padding: '10px 20px', borderRadius: 99,
                  border: '1px solid #e8e8e8', background: '#fafafa',
                  fontSize: 15, fontWeight: 600, color: '#333',
                }}>
                  {area}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Callback form ── */}
      <section id="contact" style={{ padding: '72px 24px', background: '#F7F7F7' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#FF6B35', marginBottom: 12 }}>
            Get In Touch
          </div>
          <h2 style={{ fontSize: 'clamp(24px, 4vw, 36px)', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 12 }}>
            Request a Callback
          </h2>
          <p style={{ color: '#666', marginBottom: 36, fontSize: 15, lineHeight: 1.6 }}>
            Leave your name and number — we&apos;ll call you back promptly. All enquiries are handled with complete discretion.
          </p>
          <CallbackForm slug={slug} />
          {company.phone && (
            <p style={{ marginTop: 28, fontSize: 14, color: '#888' }}>
              Or call us directly:{' '}
              <a href={`tel:${company.phone}`} style={{ color: '#FF6B35', fontWeight: 700, textDecoration: 'none' }}>
                {company.phone}
              </a>
            </p>
          )}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ background: '#111', color: 'rgba(255,255,255,0.5)', padding: '32px 24px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontWeight: 700, color: '#fff', marginBottom: 4 }}>{company.name}</div>
            {company.phone && (
              <a href={`tel:${company.phone}`} style={{ color: '#FF6B35', textDecoration: 'none', fontSize: 14 }}>
                {company.phone}
              </a>
            )}
            {company.email && (
              <span style={{ fontSize: 14, marginLeft: 16 }}>
                <a href={`mailto:${company.email}`} style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>
                  {company.email}
                </a>
              </span>
            )}
          </div>
          <div style={{ fontSize: 12 }}>
            Powered by{' '}
            <a href="https://biohazards.net" style={{ color: '#FF6B35', textDecoration: 'none' }}>
              biohazards.net
            </a>
          </div>
        </div>
      </footer>

    </div>
  )
}
