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
}

export default nextConfig
