/*
 * lib/printDocument.ts
 *
 * Generates print-ready HTML for all document types using one navy SOW-style
 * shell (wrapBranded → wrapSow + cssSowPrint).
 * The output is served directly by /api/print/[docId] — clients open the URL
 * in a browser and use Print / Save as PDF to get a hard copy.
 *
 * Architecture decisions:
 * - Pure HTML+CSS string generation (no React) so it works in any Node context.
 * - Plain user text uses esc(); rich prose fields (TipTap HTML) use richBodyHtmlForPrint().
 * - The action bar (email/print/copy link buttons) is hidden in @media print
 *   so it doesn't appear in printed PDFs.
 * - riskBadge() colour-codes H/M/L risk ratings consistently across SWMS,
 *   JSA, and Risk Assessment tables.
 * - Photos are embedded via their public Supabase Storage URLs; for PDFs
 *   that need embedded images, use PDFDocument.tsx + /api/pdf instead.
 *
 * Entry point: buildPrintHTML() — switches on DocType and delegates to the
 * appropriate builder function.
 */
import type {
  DocType, Photo, CompanyProfile, Area,
  QuoteContent, SOWContent, AssessmentDocumentContent, SWMSContent, AuthorityToProceedContent,
  EngagementAgreementContent, ReportContent, CertificateOfDecontaminationContent,
  WasteDisposalManifestContent, JSAContent, NDAContent, RiskAssessmentContent,
  WorkStep, RiskRow, WasteItem,
} from './types'
import { DOC_TYPE_LABELS } from './types'
import { filterGroupedStages, groupPhotosByRoomAndStage, type RoomPhotoGroup } from './photoGroups'
import { richBodyHtmlForPrint } from '@/lib/richTextPrint'

// en-AU locale produces comma separators and dollar sign (e.g. $4,500.00)
const fmtMoney = (n: number) =>
  '$' + Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const todayStr = () =>
  new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })

// Minimal HTML escaping — prevents XSS from user-entered content rendered into the document
const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

/** Print CSS: navy SOW shell (cssSowPrint) — all DocTypes use this layout. */
function cssSowPrint(): string {
  return `
    body.sow-print-body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @media screen {
      body.sow-print-body { padding-top: 56px; background: #d6e2f0; }
    }
    .sow-root {
      --sow-navy: #0f2447;
      --sow-navy-mid: #1a3a6b;
      --sow-blue: #2563a8;
      --sow-blue-lt: #ddeaf7;
      --sow-blue-xs: #f0f5fb;
      --sow-mid: #3a5070;
      --sow-muted: #7a96b8;
      --sow-rule: #c8d9ee;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 10pt;
      line-height: 1.6;
      color: var(--sow-navy);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sow-root .sow-sheet {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      background: #fff;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
    }
    .sow-root .sow-top {
      background: var(--sow-navy);
      padding: 16px 18mm;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    .sow-root .sow-top-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .sow-root .sow-logo { max-height: 40px; max-width: 120px; object-fit: contain; display: block; }
    .sow-root .sow-co-name { font-size: 12pt; font-weight: 600; letter-spacing: -0.3px; color: #fff; }
    .sow-root .sow-co-sub { font-size: 7.5pt; color: var(--sow-muted); margin-top: 2px; font-weight: 400; }
    .sow-root .sow-doc-info { text-align: right; font-size: 8pt; color: var(--sow-muted); line-height: 1.9; }
    .sow-root .sow-doc-info strong { color: #fff; font-weight: 500; display: block; font-size: 9pt; }
    .sow-root .sow-mid {
      flex: 1;
      padding: 22px 18mm 18px;
    }
    .sow-root .sow-doc-title {
      font-size: 20pt;
      font-weight: 300;
      letter-spacing: -0.5px;
      color: var(--sow-navy);
      margin-bottom: 18px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--sow-rule);
    }
    .sow-root .sow-meta {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1fr;
      gap: 0;
      border: 1px solid var(--sow-rule);
      margin-bottom: 22px;
      background: var(--sow-blue-xs);
    }
    .sow-root .sow-meta-cell {
      padding: 9px 12px;
      border-right: 1px solid var(--sow-rule);
    }
    .sow-root .sow-meta-cell:last-child { border-right: none; }
    .sow-root .sow-meta-label { font-size: 7pt; text-transform: uppercase; letter-spacing: 1px; color: var(--sow-muted); margin-bottom: 3px; }
    .sow-root .sow-meta-value { font-size: 9pt; font-weight: 500; color: var(--sow-navy); word-break: break-word; }
    .sow-root .sow-summary {
      background: var(--sow-blue-lt);
      border-left: 3px solid var(--sow-blue);
      padding: 12px 14px;
      margin-bottom: 24px;
      font-size: 9.5pt;
      color: var(--sow-mid);
      line-height: 1.7;
      font-weight: 300;
    }
    .sow-root .sow-sec { margin-bottom: 18px; }
    .sow-root .sow-sec-title {
      font-size: 7.5pt;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: var(--sow-navy-mid);
      border-bottom: 1px solid var(--sow-rule);
      padding-bottom: 5px;
      margin-bottom: 8px;
    }
    .sow-root .sow-sec-body {
      font-size: 9.5pt;
      color: var(--sow-mid);
      font-weight: 300;
      line-height: 1.75;
    }
    .sow-root .body-text.sow-rich p,
    .sow-root .sow-summary.sow-rich p,
    .sow-root .sow-sec-body.sow-rich p { margin: 0 0 0.45em; }
    .sow-root .body-text.sow-rich p:last-child,
    .sow-root .sow-summary.sow-rich p:last-child,
    .sow-root .sow-sec-body.sow-rich p:last-child { margin-bottom: 0; }
    .sow-root .body-text.sow-rich ul, .sow-root .body-text.sow-rich ol,
    .sow-root .sow-summary.sow-rich ul, .sow-root .sow-summary.sow-rich ol,
    .sow-root .sow-sec-body.sow-rich ul, .sow-root .sow-sec-body.sow-rich ol {
      margin: 0.35em 0 0.5em 1.1em;
      padding-left: 0.4em;
    }
    .sow-root .sow-photo-block { margin-top: 8px; margin-bottom: 18px; }
    .sow-root .sow-photo-block .label {
      font-size: 7.5pt;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: var(--sow-navy-mid);
      margin-top: 18px;
      margin-bottom: 8px;
    }
    .sow-root .sow-photo-block .label:first-child { margin-top: 0; }
    .sow-root .sow-photo-block .body-text { font-size: 9.5pt; color: var(--sow-mid); line-height: 1.6; }
    .sow-root .photos-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 8px; }
    .sow-root .photo-card { border: 1px solid var(--sow-rule); border-radius: 7px; overflow: hidden; }
    .sow-root .photo-card img { width: 100%; height: 210px; object-fit: cover; display: block; background: #f5f5f5; }
    .sow-root .photo-meta { padding: 10px 12px; }
    .sow-root .photo-area { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--sow-blue); }
    .sow-root .photo-cap { font-size: 12px; color: var(--sow-mid); margin-top: 3px; }
    .sow-root .sow-sig {
      margin-top: 28px;
      padding-top: 18px;
      border-top: 1px solid var(--sow-rule);
    }
    .sow-root .sow-completed-by { max-width: 320px; }
    .sow-root .sow-completed-by-label { font-size: 9pt; color: var(--sow-mid); font-weight: 500; display: block; margin-bottom: 6px; }
    .sow-root .sow-completed-by-line { border-bottom: 1px solid var(--sow-navy); min-height: 24px; padding-bottom: 4px; font-size: 9.5pt; font-weight: 500; color: var(--sow-navy); word-break: break-word; }
    .sow-root .sow-completed-by-placeholder { color: var(--sow-muted); }
    /* Legacy section() / tables / totals inside branded shell */
    .sow-root .sow-mid .label {
      font-size: 7.5pt;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: var(--sow-navy-mid);
      margin-top: 18px;
      margin-bottom: 8px;
    }
    .sow-root .sow-mid .label:first-of-type { margin-top: 0; }
    .sow-root .sow-mid .body-text {
      font-size: 9.5pt;
      color: var(--sow-mid);
      line-height: 1.75;
      font-weight: 300;
    }
    .sow-root .sow-mid table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      margin-bottom: 10px;
      font-size: 9.5pt;
    }
    .sow-root .sow-mid thead th {
      background: var(--sow-navy-mid);
      color: #fff;
      padding: 8px 10px;
      font-size: 8.5pt;
      font-weight: 600;
      text-align: left;
    }
    .sow-root .sow-mid thead th.r { text-align: right; }
    .sow-root .sow-mid tbody tr { border-bottom: 1px solid var(--sow-rule); }
    .sow-root .sow-mid tbody td { padding: 8px 10px; vertical-align: top; }
    .sow-root .sow-mid tbody td.r { text-align: right; white-space: nowrap; }
    .sow-root .sow-mid tbody tr:nth-child(even) { background: var(--sow-blue-xs); }
    .sow-root .sow-mid .totals { margin-top: 6px; margin-bottom: 14px; }
    .sow-root .sow-mid .tot-row {
      display: flex;
      justify-content: flex-end;
      gap: 48px;
      padding: 4px 10px;
      font-size: 9.5pt;
      color: var(--sow-mid);
    }
    .sow-root .sow-mid .tot-row .amt { min-width: 80px; text-align: right; }
    .sow-root .sow-mid .tot-row.grand {
      font-size: 11pt;
      font-weight: 600;
      color: var(--sow-navy);
      border-top: 1px solid var(--sow-rule);
      margin-top: 6px;
      padding-top: 8px;
    }
    .sow-root .sow-mid .tot-row.grand .amt { color: var(--sow-blue); }
    .sow-root .risk-H { color: #dc2626; font-weight: 700; }
    .sow-root .risk-M { color: #d97706; font-weight: 700; }
    .sow-root .risk-L { color: #16a34a; font-weight: 700; }
    .sow-root .sow-ra-meta {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 14px;
      margin-bottom: 16px;
    }
    .sow-root .sow-cod-outcome {
      margin: 24px 0;
      padding: 20px;
      background: #f0fdf4;
      border: 2px solid #16a34a;
      border-radius: 10px;
    }
    .sow-root .sow-cod-outcome-h {
      font-size: 8.5pt;
      font-weight: 700;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: #16a34a;
      margin-bottom: 8px;
    }
    .sow-root .sow-cod-outcome-b {
      font-size: 11pt;
      color: #15803d;
      font-weight: 600;
      line-height: 1.5;
    }
    .sow-root .sow-muted-box {
      margin-top: 22px;
      padding: 14px 16px;
      background: var(--sow-blue-xs);
      border: 1px solid var(--sow-rule);
      border-radius: 8px;
      font-size: 9.5pt;
      color: var(--sow-mid);
      line-height: 1.6;
    }
    /* Multi-part bundles (iaq_multi): continuous flow — no forced page breaks */
    .sow-root .bundle-part {
      margin-top: 0;
      margin-bottom: 8px;
    }
    .sow-root .bundle-part-head {
      display: flex;
      align-items: baseline;
      gap: 10px;
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--sow-rule);
    }
    .sow-root .bundle-part-num {
      font-size: 14pt;
      font-weight: 600;
      color: var(--sow-blue);
      min-width: 1.2em;
    }
    .sow-root .bundle-part-title {
      font-size: 9.5pt;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--sow-navy-mid);
    }
    .sow-root .sow-foot {
      background: var(--sow-navy-mid);
      padding: 12px 18mm;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 7pt;
      color: var(--sow-muted);
      flex-shrink: 0;
    }
    @media screen {
      body.sow-print-body .action-bar {
        display: flex; gap: 10px; align-items: center;
        position: fixed; top: 0; left: 0; right: 0; z-index: 999;
        background: #1a1a1a; padding: 12px 20px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      }
      body.sow-print-body .action-bar .doc-title { color: #fff; font-size: 13px; font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      body.sow-print-body .ab-btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 8px 14px; border-radius: 7px; font-size: 13px; font-weight: 600;
        text-decoration: none; cursor: pointer; border: none; white-space: nowrap;
        flex-shrink: 0;
      }
      body.sow-print-body .ab-primary { background: #FF6B35; color: #fff; }
      body.sow-print-body .ab-secondary { background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); }
      body.sow-print-body .ab-secondary:hover { background: rgba(255,255,255,0.2); }
      .sow-root .sow-sheet { box-shadow: 0 8px 40px rgba(0,0,0,0.12); }
      /* Composed bundle: don’t stretch mid to full A4 — avoids huge gap before part 1 in preview */
      .sow-root.sow-root--composed-bundle .sow-sheet {
        min-height: auto;
        height: auto;
        display: block;
      }
      .sow-root.sow-root--composed-bundle .sow-mid {
        flex: none;
        min-height: 0;
      }
    }
    @media print {
      /* Let content height drive page length where supported; no forced column breaks */
      @page { size: auto; margin: 10mm 12mm; }
      body.sow-print-body { background: white !important; padding-top: 0 !important; }
      body.sow-print-body .action-bar { display: none !important; }
      .sow-root .sow-sheet {
        width: 100%;
        min-height: auto !important;
        height: auto !important;
        box-shadow: none;
        margin: 0;
        display: block !important;
      }
      .sow-root .sow-mid {
        flex: none !important;
        flex-grow: 0 !important;
        min-height: 0 !important;
      }
      .sow-root .sow-top, .sow-root .sow-foot, .sow-root .sow-meta, .sow-root .sow-summary {
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
      /* No print CSS fragmentation hints — flow as one continuous document */
      .sow-root, .sow-root * {
        break-inside: auto !important;
        page-break-inside: auto !important;
        break-before: auto !important;
        page-break-before: auto !important;
        break-after: auto !important;
        page-break-after: auto !important;
        orphans: unset !important;
        widows: unset !important;
      }
    }
  `
}

// ── Action bar (shown on screen, hidden in print) ─────────────────────────────

interface ClientInfo {
  client_name?: string
  client_email?: string
  client_phone?: string
  printUrl?: string
}

/**
 * One line for the print action bar (and email subject): avoids
 * "Assessment / Scope / Quote — Test Client — Test Client" when `docTitle`
 * already ends with the job client name.
 */
function actionBarTitleLine(docTitle: string, clientName: string): string {
  const t = docTitle.trim()
  const n = clientName.trim()
  if (!n) return t
  if (t.toLowerCase() === n.toLowerCase()) return t
  const tl = t.toLowerCase()
  const nl = n.toLowerCase()
  if (tl.endsWith(nl)) {
    const beforeName = t.slice(0, t.length - n.length).trimEnd()
    if (beforeName.length === 0 || /[—–\-]$/.test(beforeName)) return t
  }
  return `${t} — ${n}`
}

function actionBar(docTitle: string, client: ClientInfo | undefined): string {
  const url   = client?.printUrl ?? ''
  const email = client?.client_email ?? ''
  const phone = (client?.client_phone ?? '').replace(/\s/g,'')
  const name  = client?.client_name ?? ''
  const line  = actionBarTitleLine(docTitle, name)
  const subject = encodeURIComponent(line)
  const body    = encodeURIComponent(`Hi ${name.split(' ')[0]},\n\nPlease find your document at the link below:\n\n${url}\n\nKind regards`)

  return `
    <div class="action-bar">
      <span class="doc-title">${esc(line)}</span>
      <button class="ab-btn ab-primary" onclick="window.print()">🖨 Print / Save PDF</button>
      ${email ? `<a class="ab-btn ab-secondary" href="mailto:${esc(email)}?subject=${subject}&body=${body}">✉️ Email</a>` : ''}
      ${phone ? `<a class="ab-btn ab-secondary" href="sms:${esc(phone)}&body=${encodeURIComponent(`Hi ${name.split(' ')[0]}, here is your document: ${url}`)}">💬 Text Link</a>` : ''}
      <button class="ab-btn ab-secondary" onclick="navigator.clipboard.writeText('${esc(url)}').then(()=>{this.textContent='✓ Copied';setTimeout(()=>this.textContent='🔗 Copy Link',2000)})">🔗 Copy Link</button>
    </div>
  `
}

/** Full HTML wrapper (navy layout + Inter; optional screen action bar). */
function wrapSow(body: string, title: string, client: ClientInfo | undefined, showActionBar: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>${cssSowPrint()}</style>
</head>
<body class="sow-print-body">
  ${showActionBar ? actionBar(title, client) : ''}
  ${body}
</body>
</html>`
}

interface BrandedMeta {
  client: string
  address: string
  area: string
  priority: string
}

function defaultBrandedMeta(client?: ClientInfo): BrandedMeta {
  return {
    client: client?.client_name?.trim() || '—',
    address: '—',
    area: '—',
    priority: '—',
  }
}

interface WrapBrandedPrintOptions {
  /** Multi-document composed bundle — adjusts footer and print pagination hints */
  composedBundle?: boolean
  bundlePartCount?: number
  /** When false, omit the screen-only action bar (e.g. in-app preview iframe). Default true. */
  screenActionBar?: boolean
}

/** Merge bundle flags with screen action bar visibility. */
function wrapBrandedPrintOpts(screenActionBar: boolean, extra?: WrapBrandedPrintOptions): WrapBrandedPrintOptions | undefined {
  if (screenActionBar) return extra
  return { ...extra, screenActionBar: false }
}

/** Navy SOW shell: header, meta grid, mid body, footer — uses wrapSow + cssSowPrint. */
function wrapBranded(
  midBodyHtml: string,
  pageTitle: string,
  documentHeading: string,
  reference: string,
  company: CompanyProfile | null,
  client: ClientInfo | undefined,
  meta: BrandedMeta,
  printOptions?: WrapBrandedPrintOptions,
): string {
  const coName = company?.name || 'Brisbane Biohazard Cleaning'
  const coTag = company?.tagline || 'Biohazard & Forensic Remediation Services'
  const logo = company?.logo_url
    ? `<img class="sow-logo" src="${esc(company.logo_url)}" alt="${esc(coName)}">`
    : ''
  const bundleParts = printOptions?.bundlePartCount ?? 0
  const footerRef =
    printOptions?.composedBundle && bundleParts > 0
      ? `${esc(reference)} · ${bundleParts} part${bundleParts === 1 ? '' : 's'}`
      : `${esc(reference)} · Page 1 of 1`
  const rootClass = printOptions?.composedBundle ? 'sow-root sow-root--composed-bundle' : 'sow-root'
  return wrapSow(`
  <div class="${rootClass}">
    <div class="sow-sheet">
      <header class="sow-top">
        <div class="sow-top-left">
          ${logo}
          <div class="sow-co-block">
            <div class="sow-co-name">${esc(coName)}</div>
            <div class="sow-co-sub">${esc(coTag)}</div>
          </div>
        </div>
        <div class="sow-doc-info">
          <strong>${esc(reference)}</strong>
          ${todayStr()}
        </div>
      </header>
      <div class="sow-mid">
        <div class="sow-doc-title">${esc(documentHeading)}</div>
        <div class="sow-meta">
          <div class="sow-meta-cell"><div class="sow-meta-label">Client</div><div class="sow-meta-value">${esc(meta.client)}</div></div>
          <div class="sow-meta-cell"><div class="sow-meta-label">Address</div><div class="sow-meta-value">${esc(meta.address)}</div></div>
          <div class="sow-meta-cell"><div class="sow-meta-label">Area</div><div class="sow-meta-value">${esc(meta.area)}</div></div>
          <div class="sow-meta-cell"><div class="sow-meta-label">Priority</div><div class="sow-meta-value">${esc(meta.priority)}</div></div>
        </div>
        ${midBodyHtml}
      </div>
      <footer class="sow-foot">
        <span>${esc(coName)} — Confidential</span>
        <span>${footerRef}</span>
      </footer>
    </div>
  </div>
  `, pageTitle, client, printOptions?.screenActionBar !== false)
}

/** Internal staff completion — matches SOW signature styling. */
function completedBySow(typedLine?: string): string {
  const t = typedLine?.trim()
  return `
    <div class="sow-sig">
      <div class="sow-completed-by">
        <span class="sow-completed-by-label">Completed &amp; authorised by</span>
        <div class="sow-completed-by-line">${t ? esc(t) : '<span class="sow-completed-by-placeholder">&nbsp;</span>'}</div>
      </div>
    </div>
  `
}

// ── Shared fragments ──────────────────────────────────────────────────────────

function section(lbl: string, text: string): string {
  if (!text?.trim()) return ''
  const inner = richBodyHtmlForPrint(text)
  if (!inner) return ''
  return `<div class="label">${lbl}</div><div class="body-text sow-rich">${inner}</div>`
}

function photoGrid(photos: Photo[], heading: string): string {
  if (!photos.length) return ''
  return `
    <div class="label">${esc(heading)} (${photos.length})</div>
    <div class="photos-grid">
      ${photos.map(p => `
        <div class="photo-card">
          <img src="${esc(p.file_url)}" alt="${esc(p.caption || p.area_ref || '')}">
          <div class="photo-meta">
            <div class="photo-area">${esc(p.area_ref || p.category)}</div>
            ${p.caption ? `<div class="photo-cap">${esc(p.caption)}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `
}

function roomPhotoSections(groups: RoomPhotoGroup[], heading: string, stages: Array<'assessment' | 'before' | 'during' | 'after'>): string {
  const visible = filterGroupedStages(groups, stages)
  if (!visible.length) return ''
  return `
    <div class="label">${esc(heading)}</div>
    ${visible.map(group => `
      <div class="label" style="margin-top:14px;color:#1a1a1a">${esc(group.room)}</div>
      ${group.note ? `<div class="body-text" style="margin-top:-2px;margin-bottom:8px"><strong>Room notes:</strong> ${esc(group.note)}</div>` : ''}
      ${stages.map(stage => {
        const photos = group.stages[stage]
        return photos.length ? photoGrid(photos, `${stage.charAt(0).toUpperCase() + stage.slice(1)} Photos`) : ''
      }).join('')}
    `).join('')}
  `
}

/* Colour-codes a risk level string — H=red, M=amber, L=green.
   Checks only the first character so values like "High", "H", "Medium" all match. */
function riskBadge(r: string): string {
  const cls = r?.toUpperCase().startsWith('H') ? 'risk-H' : r?.toUpperCase().startsWith('M') ? 'risk-M' : 'risk-L'
  return `<span class="${cls}">${esc(r)}</span>`
}

function stepsTable(steps: WorkStep[]): string {
  if (!steps?.length) return ''
  return `
    <table>
      <thead>
        <tr>
          <th>Step / Task</th>
          <th>Hazards</th>
          <th class="r">Risk<br>Before</th>
          <th>Control Measures</th>
          <th class="r">Risk<br>After</th>
          <th>Responsible</th>
        </tr>
      </thead>
      <tbody>
        ${steps.map((s, i) => `
          <tr>
            <td><strong>${i+1}.</strong> ${esc(s.step)}</td>
            <td>${esc(s.hazards)}</td>
            <td class="r">${riskBadge(s.risk_before)}</td>
            <td>${esc(s.controls)}</td>
            <td class="r">${riskBadge(s.risk_after)}</td>
            <td>${esc(s.responsible)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}

function riskTable(risks: RiskRow[]): string {
  if (!risks?.length) return ''
  return `
    <table>
      <thead>
        <tr>
          <th>Hazard</th>
          <th class="r">Like.</th>
          <th class="r">Cons.</th>
          <th class="r">Rating</th>
          <th>Controls</th>
          <th class="r">Residual</th>
        </tr>
      </thead>
      <tbody>
        ${risks.map(r => `
          <tr>
            <td>${esc(r.hazard)}</td>
            <td class="r">${riskBadge(r.likelihood)}</td>
            <td class="r">${riskBadge(r.consequence)}</td>
            <td class="r">${riskBadge(r.risk_rating)}</td>
            <td>${esc(r.controls)}</td>
            <td class="r">${riskBadge(r.residual_risk)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}

function wasteTable(items: WasteItem[]): string {
  if (!items?.length) return ''
  return `
    <table>
      <thead>
        <tr>
          <th>Waste Description</th>
          <th class="r">Qty</th>
          <th class="r">Unit</th>
          <th>Disposal Method</th>
          <th>Facility</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(w => `
          <tr>
            <td>${esc(w.description)}</td>
            <td class="r">${esc(w.quantity)}</td>
            <td class="r">${esc(w.unit)}</td>
            <td>${esc(w.disposal_method)}</td>
            <td>${esc(w.facility)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}

// ── 1. Quote ──────────────────────────────────────────────────────────────────

function buildQuoteMid(
  c: QuoteContent,
  photos: Photo[],
  groups: RoomPhotoGroup[],
  _company: CompanyProfile | null,
  _jobId: string,
  _appUrl: string,
  _client: ClientInfo | undefined,
  includeCompletion: boolean,
): string {
  const before = photos.filter(p => ['before','assessment'].includes(p.category))
  const items = (c.line_items || []).map(li => `
    <tr>
      <td>${esc(li.description)}</td>
      <td class="r">${li.qty}</td>
      <td class="r">${esc(li.unit)}</td>
      <td class="r">${fmtMoney(li.rate)}</td>
      <td class="r">${fmtMoney(li.total)}</td>
    </tr>
  `).join('')

  return `
    <div class="label">Overview</div><div class="body-text sow-rich">${richBodyHtmlForPrint(c.intro)}</div>
    <div class="label">Scope &amp; Pricing</div>
    <table>
      <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Rate</th><th class="r">Total</th></tr></thead>
      <tbody>${items}</tbody>
    </table>
    <div class="totals">
      <div class="tot-row"><span>Subtotal</span><span class="amt">${fmtMoney(c.subtotal)}</span></div>
      ${c.gst > 0 ? `<div class="tot-row"><span>GST (10%)</span><span class="amt">${fmtMoney(c.gst)}</span></div>` : ''}
      <div class="tot-row grand"><span>TOTAL</span><span class="amt">${fmtMoney(c.total)}</span></div>
    </div>
    ${section('Notes &amp; Conditions', c.notes)}
    ${section('Payment Terms', c.payment_terms)}
    ${section('Quote Validity', c.validity)}
    ${c.include_photos !== false ? roomPhotoSections(groups, 'Site Condition Photos', ['assessment', 'before']) : photoGrid(before, 'Site Condition Photos')}
    ${includeCompletion ? completedBySow(c.completed_by) : ''}
  `
}

function buildQuoteHTML(c: QuoteContent, photos: Photo[], groups: RoomPhotoGroup[], company: CompanyProfile | null, _jobId: string, _appUrl: string, client: ClientInfo | undefined, screenActionBar: boolean): string {
  const mid = buildQuoteMid(c, photos, groups, company, _jobId, _appUrl, client, true)
  return wrapBranded(mid, c.title, c.title, c.reference, company, client, defaultBrandedMeta(client), wrapBrandedPrintOpts(screenActionBar))
}

// ── 2. SOW ────────────────────────────────────────────────────────────────────

function sowClientLabel(c: SOWContent, client?: ClientInfo): string {
  const n = client?.client_name?.trim()
  if (n) return n
  const m = c.title.match(/^Scope of Work\s*[—–-]\s*(.+)$/i)
  return m ? m[1].trim() : '—'
}

function sowBodySection(lbl: string, text: string | undefined): string {
  if (!text?.trim()) return ''
  const inner = richBodyHtmlForPrint(text)
  if (!inner) return ''
  return `<div class="sow-sec"><div class="sow-sec-title">${esc(lbl)}</div><div class="sow-sec-body sow-rich">${inner}</div></div>`
}

function buildSOWMid(
  c: SOWContent,
  photos: Photo[],
  groups: RoomPhotoGroup[],
  client: ClientInfo | undefined,
  areas: Area[],
  includeCompletion: boolean,
): string {
  const before = photos.filter(p => ['before', 'assessment'].includes(p.category))

  const photosInner =
    c.include_photos !== false
      ? roomPhotoSections(groups, 'Site Condition Photos', ['assessment', 'before'])
      : photoGrid(before, 'Site Condition Photos')
  const photosHtml = photosInner ? `<div class="sow-photo-block">${photosInner}</div>` : ''

  return `
    ${c.executive_summary?.trim() ? `<div class="sow-summary sow-rich">${richBodyHtmlForPrint(c.executive_summary)}</div>` : ''}
    ${sowBodySection('Scope of Work', c.scope)}
    ${sowBodySection('Methodology', c.methodology)}
    ${sowBodySection('Safety Protocols', c.safety_protocols)}
    ${sowBodySection('Waste Disposal', c.waste_disposal)}
    ${sowBodySection('Timeline', c.timeline)}
    ${sowBodySection('Exclusions', c.exclusions)}
    ${photosHtml}
    ${sowBodySection('Disclaimer', c.disclaimer)}
    ${includeCompletion ? completedBySow(c.completed_by) : ''}
  `
}

function buildSOWHTML(
  c: SOWContent,
  photos: Photo[],
  groups: RoomPhotoGroup[],
  company: CompanyProfile | null,
  client: ClientInfo | undefined,
  areas: Area[],
  screenActionBar: boolean,
): string {
  const clientName = sowClientLabel(c, client)
  const addr = (c.meta_site_address || '').trim() || '—'
  const area =
    (c.meta_area_label || '').trim() ||
    (areas[0]?.name ? areas[0].name : '—')
  const pri = (c.meta_priority || '').trim() || '—'

  const mid = buildSOWMid(c, photos, groups, client, areas, true)
  return wrapBranded(mid, c.title, 'Scope of Work', c.reference, company, client, {
    client: clientName,
    address: addr,
    area,
    priority: pri,
  }, wrapBrandedPrintOpts(screenActionBar))
}

// ── 3. SWMS ───────────────────────────────────────────────────────────────────

function buildSWMSMid(c: SWMSContent, includeCompletion: boolean): string {
  return `
    ${section('Project Details', c.project_details)}
    <div class="label">Work Steps, Hazards &amp; Controls</div>
    ${stepsTable(c.steps)}
    ${section('PPE Required', c.ppe_required)}
    ${section('Emergency Procedures', c.emergency_procedures)}
    ${section('Legislation &amp; References', c.legislation_references)}
    <div class="label">Worker Declarations</div>
    <div class="body-text">${esc(c.declarations)}</div>
    ${includeCompletion ? completedBySow(c.completed_by) : ''}
  `
}

function buildSWMSHTML(c: SWMSContent, company: CompanyProfile | null, client: ClientInfo | undefined, screenActionBar: boolean): string {
  const mid = buildSWMSMid(c, true)
  return wrapBranded(mid, c.title, c.title, c.reference, company, client, defaultBrandedMeta(client), wrapBrandedPrintOpts(screenActionBar))
}

// ── 4. Authority to Proceed ───────────────────────────────────────────────────

function buildATPMid(c: AuthorityToProceedContent, includeCompletion: boolean): string {
  return `
    ${section('Scope of Works Authorised', c.scope_summary)}
    ${section('Site Access Details', c.access_details)}
    ${section('Special Conditions', c.special_conditions)}
    ${section('Liability Acknowledgment', c.liability_acknowledgment)}
    ${section('Payment Authorisation', c.payment_authorisation)}
    ${includeCompletion ? completedBySow(c.completed_by) : ''}
  `
}

function buildATPHTML(c: AuthorityToProceedContent, company: CompanyProfile | null, client: ClientInfo | undefined, screenActionBar: boolean): string {
  const mid = buildATPMid(c, true)
  return wrapBranded(mid, c.title, c.title, c.reference, company, client, defaultBrandedMeta(client), wrapBrandedPrintOpts(screenActionBar))
}

// ── 5. Engagement Agreement ───────────────────────────────────────────────────

function buildEngagementMid(c: EngagementAgreementContent, includeCompletion: boolean): string {
  return `
    ${section('Parties', c.parties)}
    ${section('Services', c.services_description)}
    ${section('Fees &amp; Payment', c.fees_and_payment)}
    ${section('Limitation of Liability', c.liability_limitations)}
    ${section('Confidentiality', c.confidentiality)}
    ${section('Dispute Resolution', c.dispute_resolution)}
    ${section('Termination', c.termination)}
    ${section('Governing Law', c.governing_law)}
    ${includeCompletion ? completedBySow(c.completed_by) : ''}
  `
}

function buildEngagementHTML(c: EngagementAgreementContent, company: CompanyProfile | null, client: ClientInfo | undefined, screenActionBar: boolean): string {
  const mid = buildEngagementMid(c, true)
  return wrapBranded(mid, c.title, c.title, c.reference, company, client, defaultBrandedMeta(client), wrapBrandedPrintOpts(screenActionBar))
}

// ── 6. Completion Report ──────────────────────────────────────────────────────

function buildReportMid(c: ReportContent, photos: Photo[], groups: RoomPhotoGroup[], includeCompletion: boolean): string {
  const before = photos.filter(p => ['before','assessment'].includes(p.category))
  const during = photos.filter(p => p.category === 'during')
  const after  = photos.filter(p => p.category === 'after')
  return `
    ${section('Executive Summary', c.executive_summary)}
    ${section('Site Conditions on Arrival', c.site_conditions)}
    ${roomPhotoSections(groups, 'Before & Assessment Evidence', ['assessment', 'before'])}
    ${section('Works Carried Out', c.works_carried_out)}
    ${section('Methodology', c.methodology)}
    ${section('Products &amp; Equipment Used', c.products_used)}
    ${section('Waste Disposal', c.waste_disposal)}
    ${c.include_photos !== false ? roomPhotoSections(groups, 'During Works Photos', ['during']) : photoGrid(during, 'During Works Photos')}
    ${section('Photo Record', c.photo_record)}
    ${section('Outcome', c.outcome)}
    ${c.include_photos !== false ? roomPhotoSections(groups, 'Completion Photos', ['after']) : photoGrid(after, 'Completion Photos')}
    ${includeCompletion ? completedBySow(c.completed_by) : ''}
  `
}

function buildReportHTML(c: ReportContent, photos: Photo[], groups: RoomPhotoGroup[], company: CompanyProfile | null, client: ClientInfo | undefined, screenActionBar: boolean): string {
  const mid = buildReportMid(c, photos, groups, true)
  return wrapBranded(mid, c.title, c.title, c.reference, company, client, defaultBrandedMeta(client), wrapBrandedPrintOpts(screenActionBar))
}

// ── 7. Certificate of Decontamination ─────────────────────────────────────────

function buildCODMid(c: CertificateOfDecontaminationContent, includeCompletion: boolean): string {
  return `
    <div style="margin-bottom:18px">
      <div class="label">Date of Works</div><div class="body-text">${esc(c.date_of_works)}</div>
    </div>
    ${section('Works Summary', c.works_summary)}
    ${section('Decontamination Standard', c.decontamination_standard)}
    ${section('Products Used', c.products_used)}
    <div class="sow-cod-outcome">
      <div class="sow-cod-outcome-h">Outcome</div>
      <div class="sow-cod-outcome-b">${esc(c.outcome_statement)}</div>
    </div>
    ${section('Limitations', c.limitations)}
    <div class="sow-muted-box" style="margin-top:22px">${esc(c.certifier_statement)}</div>
    ${includeCompletion ? completedBySow(c.completed_by) : ''}
  `
}

function buildCODHTML(c: CertificateOfDecontaminationContent, company: CompanyProfile | null, client: ClientInfo | undefined, screenActionBar: boolean): string {
  const mid = buildCODMid(c, true)
  return wrapBranded(mid, c.title, c.title, c.reference, company, client, defaultBrandedMeta(client), wrapBrandedPrintOpts(screenActionBar))
}

// ── 8. Waste Disposal Manifest ────────────────────────────────────────────────

function buildWDMMid(c: WasteDisposalManifestContent, includeCompletion: boolean): string {
  return `
    <div class="label">Collection Date</div><div class="body-text">${esc(c.collection_date)}</div>
    <div class="label">Waste Items</div>
    ${wasteTable(c.waste_items)}
    ${section('Transport Details', c.transport_details)}
    <div class="sow-muted-box" style="margin-top:22px"><strong>Declaration:</strong> ${esc(c.declaration)}</div>
    ${includeCompletion ? completedBySow(c.completed_by) : ''}
  `
}

function buildWDMHTML(c: WasteDisposalManifestContent, company: CompanyProfile | null, client: ClientInfo | undefined, screenActionBar: boolean): string {
  const mid = buildWDMMid(c, true)
  return wrapBranded(mid, c.title, c.title, c.reference, company, client, defaultBrandedMeta(client), wrapBrandedPrintOpts(screenActionBar))
}

// ── 9. JSA ────────────────────────────────────────────────────────────────────

function buildJSAMid(c: JSAContent, includeCompletion: boolean): string {
  return `
    ${section('Job Description', c.job_description)}
    <div class="label">Steps, Hazards &amp; Controls</div>
    ${stepsTable(c.steps)}
    ${section('PPE Required', c.ppe_required)}
    ${section('Emergency Contacts', c.emergency_contacts)}
    <div class="label">Worker Sign-Off</div>
    <div class="body-text">${esc(c.sign_off)}</div>
    ${includeCompletion ? completedBySow(c.completed_by) : ''}
  `
}

function buildJSAHTML(c: JSAContent, company: CompanyProfile | null, client: ClientInfo | undefined, screenActionBar: boolean): string {
  const mid = buildJSAMid(c, true)
  return wrapBranded(mid, c.title, c.title, c.reference, company, client, defaultBrandedMeta(client), wrapBrandedPrintOpts(screenActionBar))
}

// ── 10. NDA ───────────────────────────────────────────────────────────────────

function buildNDAMid(c: NDAContent, includeCompletion: boolean): string {
  return `
    ${section('Parties', c.parties)}
    ${section('Confidential Information', c.confidential_information_definition)}
    ${section('Obligations', c.obligations)}
    ${section('Exceptions', c.exceptions)}
    ${section('Term', c.term)}
    ${section('Remedies', c.remedies)}
    ${section('Governing Law', c.governing_law)}
    ${includeCompletion ? completedBySow(c.completed_by) : ''}
  `
}

function buildNDAHTML(c: NDAContent, company: CompanyProfile | null, client: ClientInfo | undefined, screenActionBar: boolean): string {
  const mid = buildNDAMid(c, true)
  return wrapBranded(mid, c.title, c.title, c.reference, company, client, defaultBrandedMeta(client), wrapBrandedPrintOpts(screenActionBar))
}

// ── 11. Risk Assessment ───────────────────────────────────────────────────────

function buildRAMid(c: RiskAssessmentContent, includeCompletion: boolean): string {
  return `
    <div class="sow-ra-meta">
      <div><div class="label">Site</div><div class="body-text">${esc(c.site_description)}</div></div>
      <div><div class="label">Date</div><div class="body-text">${esc(c.assessment_date)}</div></div>
      <div><div class="label">Assessor</div><div class="body-text">${esc(c.assessor)}</div></div>
    </div>
    <div class="label">Risk Register</div>
    ${riskTable(c.risks)}
    <div class="sow-muted-box" style="margin:16px 0">
      <strong>Overall Risk Rating: </strong>${riskBadge(c.overall_risk_rating)}
    </div>
    ${section('Recommendations', c.recommendations)}
    ${section('Review Date', c.review_date)}
    ${includeCompletion ? completedBySow(c.completed_by) : ''}
  `
}

function buildRAHTML(c: RiskAssessmentContent, company: CompanyProfile | null, client: ClientInfo | undefined, screenActionBar: boolean): string {
  const mid = buildRAMid(c, true)
  return wrapBranded(mid, c.title, c.title, c.reference, company, client, defaultBrandedMeta(client), wrapBrandedPrintOpts(screenActionBar))
}

// ── 12. Assessment document (narrative — same capture shape as Assessment → Document) ─

function buildAssessmentDocumentMid(c: AssessmentDocumentContent, includeCompletion: boolean): string {
  return `
    ${section('Site summary', c.site_summary)}
    ${section('Hazards overview', c.hazards_overview)}
    ${section('Risks overview', c.risks_overview)}
    ${section('Control measures', c.control_measures)}
    ${section('Recommendations', c.recommendations)}
    ${section('Limitations', c.limitations)}
    ${includeCompletion ? completedBySow(c.completed_by) : ''}
  `
}

function buildAssessmentDocumentHTML(c: AssessmentDocumentContent, company: CompanyProfile | null, client: ClientInfo | undefined, screenActionBar: boolean): string {
  const mid = buildAssessmentDocumentMid(c, true)
  return wrapBranded(mid, c.title, c.title, c.reference, company, client, defaultBrandedMeta(client), wrapBrandedPrintOpts(screenActionBar))
}

/** Mid-body HTML only (no shell). Used for composed bundles; omit per-part completion when includeCompletion is false. */
export interface PrintMidOptions {
  includeCompletion?: boolean
}

export function buildPrintMidHTML(
  type: DocType,
  content: Record<string, unknown>,
  photos: Photo[],
  areas: Area[],
  company: CompanyProfile | null,
  jobId: string,
  appUrl: string,
  client: ClientInfo | undefined,
  options?: PrintMidOptions,
): string {
  const includeCompletion = options?.includeCompletion !== false
  const c = content as Record<string, unknown>
  const groups = groupPhotosByRoomAndStage(photos, areas)
  switch (type) {
    case 'quote':
      return buildQuoteMid(c as unknown as QuoteContent, photos, groups, company, jobId, appUrl, client, includeCompletion)
    case 'sow':
      return buildSOWMid(c as unknown as SOWContent, photos, groups, client, areas, includeCompletion)
    case 'swms':
      return buildSWMSMid(c as unknown as SWMSContent, includeCompletion)
    case 'authority_to_proceed':
      return buildATPMid(c as unknown as AuthorityToProceedContent, includeCompletion)
    case 'engagement_agreement':
      return buildEngagementMid(c as unknown as EngagementAgreementContent, includeCompletion)
    case 'report':
      return buildReportMid(c as unknown as ReportContent, photos, groups, includeCompletion)
    case 'certificate_of_decontamination':
      return buildCODMid(c as unknown as CertificateOfDecontaminationContent, includeCompletion)
    case 'waste_disposal_manifest':
      return buildWDMMid(c as unknown as WasteDisposalManifestContent, includeCompletion)
    case 'jsa':
      return buildJSAMid(c as unknown as JSAContent, includeCompletion)
    case 'nda':
      return buildNDAMid(c as unknown as NDAContent, includeCompletion)
    case 'risk_assessment':
      return buildRAMid(c as unknown as RiskAssessmentContent, includeCompletion)
    case 'assessment_document':
      return buildAssessmentDocumentMid(c as unknown as AssessmentDocumentContent, includeCompletion)
    default:
      return `<p class="body-text">${esc('Unknown document type')}</p>`
  }
}

function referenceFromContent(content: Record<string, unknown>): string {
  const r = content.reference
  return typeof r === 'string' && r.trim() ? r.trim() : '—'
}

/** Single print output: ordered parts (each type + content) between one header/footer. */
export function buildComposedBundleHTML(
  parts: Array<{ type: DocType; content: Record<string, unknown> }>,
  bundleTitle: string,
  photos: Photo[],
  areas: Area[],
  company: CompanyProfile | null,
  jobId: string,
  appUrl: string,
  client: ClientInfo | undefined,
  screenActionBar = true,
): string {
  const bundleReference =
    parts.length > 0 ? referenceFromContent(parts[0].content) : '—'
  const inner = parts
    .map((p, i) => {
      const mid = buildPrintMidHTML(p.type, p.content, photos, areas, company, jobId, appUrl, client, {
        includeCompletion: false,
      })
      const label = DOC_TYPE_LABELS[p.type] ?? p.type
      return `<section class="bundle-part" data-part="${i + 1}"><div class="bundle-part-head"><span class="bundle-part-num">${i + 1}</span><span class="bundle-part-title">${esc(label)}</span></div><div class="bundle-part-body">${mid}</div></section>`
    })
    .join('')
  const pageTitle = bundleTitle.trim() || 'Composed document'
  return wrapBranded(inner, pageTitle, pageTitle, bundleReference, company, client, defaultBrandedMeta(client), wrapBrandedPrintOpts(screenActionBar, {
    composedBundle: true,
    bundlePartCount: parts.length,
  }))
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Main export. Converts stored document content + job photos into a full
 * HTML document ready to serve as a print/PDF page.
 *
 * @param type     - One of the DocType values
 * @param content  - The JSON document content blob from the documents table
 * @param photos   - Photos for this job (filtered by category inside each builder)
 * @param company  - Company profile for branding; falls back to hardcoded defaults
 * @param jobId    - Used to construct the quote accept URL
 * @param appUrl   - Base URL for accept/print links
 * @param client   - Optional client info for the screen-only action bar (email/SMS)
 * @param options  - Set `screenActionBar: false` for in-app preview iframes (no embedded toolbar)
 */
export interface BuildPrintHTMLOptions {
  screenActionBar?: boolean
}

export function buildPrintHTML(
  type: DocType,
  content: Record<string, unknown>,
  photos: Photo[],
  areas: Area[] = [],
  company: CompanyProfile | null,
  jobId: string,
  appUrl: string,
  client?: ClientInfo,
  options?: BuildPrintHTMLOptions,
): string {
  const c = content as Record<string, unknown>
  const groups = groupPhotosByRoomAndStage(photos, areas)
  const screenActionBar = options?.screenActionBar !== false
  switch (type) {
    case 'quote':                      return buildQuoteHTML(c as unknown as QuoteContent, photos, groups, company, jobId, appUrl, client, screenActionBar)
    case 'sow':                        return buildSOWHTML(c as unknown as SOWContent, photos, groups, company, client, areas, screenActionBar)
    case 'swms':                       return buildSWMSHTML(c as unknown as SWMSContent, company, client, screenActionBar)
    case 'authority_to_proceed':       return buildATPHTML(c as unknown as AuthorityToProceedContent, company, client, screenActionBar)
    case 'engagement_agreement':       return buildEngagementHTML(c as unknown as EngagementAgreementContent, company, client, screenActionBar)
    case 'report':                     return buildReportHTML(c as unknown as ReportContent, photos, groups, company, client, screenActionBar)
    case 'certificate_of_decontamination': return buildCODHTML(c as unknown as CertificateOfDecontaminationContent, company, client, screenActionBar)
    case 'waste_disposal_manifest':    return buildWDMHTML(c as unknown as WasteDisposalManifestContent, company, client, screenActionBar)
    case 'jsa':                        return buildJSAHTML(c as unknown as JSAContent, company, client, screenActionBar)
    case 'nda':                        return buildNDAHTML(c as unknown as NDAContent, company, client, screenActionBar)
    case 'risk_assessment':            return buildRAHTML(c as unknown as RiskAssessmentContent, company, client, screenActionBar)
    case 'assessment_document':        return buildAssessmentDocumentHTML(c as unknown as AssessmentDocumentContent, company, client, screenActionBar)
    case 'iaq_multi': {
      const partsRaw = c.parts
      const bundleTitle =
        typeof c.title === 'string' && c.title.trim()
          ? c.title.trim()
          : 'Assessment / Scope / Quote'
      if (!Array.isArray(partsRaw) || partsRaw.length === 0) {
        return '<body><p class="body-text">Invalid multi-document content</p></body>'
      }
      const parts = partsRaw as Array<{ type: DocType; content: Record<string, unknown> }>
      return buildComposedBundleHTML(parts, bundleTitle, photos, areas, company, jobId, appUrl, client, screenActionBar)
    }
    default:                           return '<body><p>Unknown document type</p></body>'
  }
}
