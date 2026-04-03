/*
 * app/api/public/[slug]/route.ts
 *
 * GET /api/public/[slug] — returns the public profile for a company.
 * Used by the public website template (app/site/page.tsx) to render
 * the company's public-facing page at companyname.biohazards.net.
 *
 * Fully public — no auth required. Only returns fields safe for public display:
 * name, phone, email, abn, logo, services, areas_served, tagline.
 * Never returns internal job data, capabilities, or team information.
 */
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  if (!slug) return NextResponse.json({ error: 'Missing slug' }, { status: 400 })

  const supabase = createServiceClient()

  // Find org by slug
  const { data: org } = await supabase
    .from('orgs')
    .select('id, name, slug')
    .eq('slug', slug)
    .single()

  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Get public-safe company profile fields
  const { data: profile } = await supabase
    .from('company_profile')
    .select('name, phone, email, abn, logo_url, tagline, services, areas_served, website_live')
    .eq('org_id', org.id)
    .single()

  return NextResponse.json({
    company: {
      slug: org.slug,
      name: profile?.name ?? org.name,
      phone: profile?.phone ?? null,
      email: profile?.email ?? null,
      abn: profile?.abn ?? null,
      logo_url: profile?.logo_url ?? null,
      tagline: profile?.tagline ?? null,
      services: profile?.services ?? null,
      areas_served: profile?.areas_served ?? null,
      website_live: profile?.website_live ?? false,
    }
  })
}
