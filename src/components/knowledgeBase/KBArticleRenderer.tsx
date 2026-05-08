/*
 * components/knowledgeBase/KBArticleRenderer.tsx
 *
 * Walks an article's Block[] and produces JSX. Server-safe (no hooks, no
 * client APIs) so article pages can be statically rendered. Styling is
 * inline-with-CSS-variables to match the app's existing convention.
 *
 * Headings emit `id` attributes that the right-side TOC anchors to — the
 * author picks the IDs in the article data, so they survive copy edits.
 */
import type { Block, CalloutVariant } from '@/lib/knowledgeBase/types'
import type { CSSProperties, ReactElement } from 'react'

const PROSE_WIDTH = 720

const styles: Record<string, CSSProperties> = {
  paragraph: {
    fontSize: 15,
    lineHeight: 1.7,
    color: 'var(--text)',
    margin: '0 0 18px',
    maxWidth: PROSE_WIDTH,
  },
  h2: {
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: '-0.02em',
    color: 'var(--text)',
    margin: '40px 0 14px',
    scrollMarginTop: 96,
  },
  h3: {
    fontSize: 17,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    color: 'var(--text)',
    margin: '28px 0 10px',
    scrollMarginTop: 96,
  },
  list: {
    fontSize: 15,
    lineHeight: 1.7,
    color: 'var(--text)',
    margin: '0 0 18px',
    paddingLeft: 22,
    maxWidth: PROSE_WIDTH,
  },
  listItem: {
    marginBottom: 6,
  },
  code: {
    fontFamily: "'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace",
    fontSize: 13,
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '12px 14px',
    color: 'var(--text)',
    margin: '0 0 18px',
    overflowX: 'auto',
    maxWidth: PROSE_WIDTH,
    whiteSpace: 'pre-wrap',
  },
  tableWrap: {
    maxWidth: PROSE_WIDTH,
    overflowX: 'auto',
    border: '1px solid var(--border)',
    borderRadius: 10,
    margin: '0 0 20px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '10px 14px',
    background: 'var(--surface-2)',
    borderBottom: '1px solid var(--border)',
    fontWeight: 700,
    letterSpacing: '0.02em',
    color: 'var(--text)',
  },
  td: {
    padding: '10px 14px',
    borderBottom: '1px solid var(--border)',
    color: 'var(--text)',
    verticalAlign: 'top',
  },
}

const CALLOUT_COLOURS: Record<CalloutVariant, { border: string; bg: string; dot: string; title: string }> = {
  info:    { border: 'rgba(59,130,246,0.35)', bg: 'rgba(59,130,246,0.08)', dot: '#60A5FA', title: '#93C5FD' },
  tip:     { border: 'rgba(34,197,94,0.35)',  bg: 'rgba(34,197,94,0.08)',  dot: '#4ADE80', title: '#86EFAC' },
  warning: { border: 'rgba(245,158,11,0.35)', bg: 'rgba(245,158,11,0.08)', dot: '#FBBF24', title: '#FCD34D' },
  danger:  { border: 'rgba(239,68,68,0.40)',  bg: 'rgba(239,68,68,0.08)',  dot: '#F87171', title: '#FCA5A5' },
}

function Callout({ variant, title, text }: { variant: CalloutVariant; title?: string; text: string }) {
  const c = CALLOUT_COLOURS[variant]
  return (
    <div
      style={{
        maxWidth: PROSE_WIDTH,
        margin: '0 0 20px',
        padding: '14px 16px',
        border: `1px solid ${c.border}`,
        background: c.bg,
        borderRadius: 10,
        display: 'flex',
        gap: 12,
      }}
    >
      <span aria-hidden style={{ color: c.dot, fontSize: 14, lineHeight: '1.7', flex: '0 0 auto' }}>●</span>
      <div>
        {title ? (
          <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.01em', color: c.title, marginBottom: 4 }}>
            {title}
          </div>
        ) : null}
        <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>{text}</div>
      </div>
    </div>
  )
}

export function KBArticleRenderer({ blocks }: { blocks: Block[] }) {
  const out: ReactElement[] = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    switch (b.type) {
      case 'p':
        out.push(<p key={i} style={styles.paragraph}>{b.text}</p>)
        break
      case 'h2':
        out.push(<h2 key={i} id={b.id} style={styles.h2}>{b.text}</h2>)
        break
      case 'h3':
        out.push(<h3 key={i} id={b.id} style={styles.h3}>{b.text}</h3>)
        break
      case 'ul':
        out.push(
          <ul key={i} style={styles.list}>
            {b.items.map((item, j) => <li key={j} style={styles.listItem}>{item}</li>)}
          </ul>
        )
        break
      case 'ol':
        out.push(
          <ol key={i} style={styles.list}>
            {b.items.map((item, j) => <li key={j} style={styles.listItem}>{item}</li>)}
          </ol>
        )
        break
      case 'callout':
        out.push(<Callout key={i} variant={b.variant} title={b.title} text={b.text} />)
        break
      case 'table':
        out.push(
          <div key={i} style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>{b.headers.map((h, j) => <th key={j} style={styles.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => <td key={c} style={styles.td}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        break
      case 'code':
        out.push(<pre key={i} style={styles.code}>{b.text}</pre>)
        break
    }
  }
  return <div>{out}</div>
}
