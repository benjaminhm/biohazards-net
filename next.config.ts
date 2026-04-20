import path from 'path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Pin repo root so Turbopack does not pick a stray lockfile higher in the tree (e.g. ~/package-lock.json).
  turbopack: {
    root: path.join(__dirname),
  },
  transpilePackages: ['@react-pdf/renderer'],
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
