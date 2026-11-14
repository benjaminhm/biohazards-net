import os from 'os'
import path from 'path'
import type { NextConfig } from 'next'

function lanDevOrigins(): string[] {
  try {
    const hosts = new Set<string>()
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list ?? []) {
        if (net.family === 'IPv4' && !net.internal) hosts.add(net.address)
      }
    }
    return [...hosts]
  } catch {
    return []
  }
}

const nextConfig: NextConfig = {
  // Phone on the same Wi-Fi loads the dev server by LAN IP. Without this, Next blocks /_next.
  allowedDevOrigins: lanDevOrigins(),
  // Pin repo root so Turbopack does not pick a stray lockfile higher in the tree (e.g. ~/package-lock.json).
  turbopack: {
    root: path.join(__dirname),
  },
  transpilePackages: ['@react-pdf/renderer', 'pdfjs-dist'],
  // Signed quote PDFs are rendered with headless Chrome (lib/signing/pdf.ts). On Vercel the
  // browser is unpacked at run time from these compressed files, which file tracing cannot
  // see because nothing imports them. Only the routes that make a PDF carry them.
  outputFileTracingIncludes: {
    '/api/sign/*': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/sign/*/pdf': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/signing/*': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/signing/*/pdf': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/pack/*/pdf': ['./node_modules/@sparticuz/chromium/bin/**'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  // Route renames: tile labels are the source of truth.
  //   /training → /knowledge-base   (label: "Knowledge Base")
  //   /website  → /marketing        (label: "Marketing Manager")
  // Permanent (308) so bookmarks, PWA shortcuts, and any emailed links keep working.
  async redirects() {
    return [
      { source: '/training',        destination: '/knowledge-base',        permanent: true },
      { source: '/training/:path*', destination: '/knowledge-base/:path*', permanent: true },
      { source: '/website',         destination: '/marketing',             permanent: true },
      { source: '/website/:path*',  destination: '/marketing/:path*',      permanent: true },
    ]
  },
}

export default nextConfig
