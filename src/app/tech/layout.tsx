'use client'

import { useEffect, type ReactNode } from 'react'
import { flushPhotoQueue } from '@/lib/photoQueue'

export default function TechLayout({ children }: { children: ReactNode }) {
  useEffect(() => {
    const run = () => { flushPhotoQueue().catch(() => {}) }
    run()
    const timer = window.setInterval(run, 15000)
    window.addEventListener('online', run)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', run)
    }
  }, [])
  return children
}
