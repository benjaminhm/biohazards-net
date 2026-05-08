/*
 * app/knowledge-base/layout.tsx
 *
 * Nested layout for the Knowledge Base. Server component that wraps all
 * /knowledge-base/* pages in the <KBShell> client component — giving every
 * KB page the same topbar, sidebar, search modal, and feature-flag gate
 * without the shell remounting between navigations.
 *
 * Keeping this a server component means the article pages below can stay
 * statically renderable (SSG); only <KBShell> runs on the client.
 */
import type { ReactNode } from 'react'
import { KBShell } from '@/components/knowledgeBase/KBShell'

export const metadata = {
  title: 'Knowledge Base',
}

export default function KnowledgeBaseLayout({ children }: { children: ReactNode }) {
  return <KBShell>{children}</KBShell>
}
