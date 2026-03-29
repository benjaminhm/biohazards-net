import type { DocType, Photo, CompanyProfile, QuoteContent, SOWContent, ReportContent } from './types'

const fmtMoney = (n: number) =>
  '$' + Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const todayStr = () =>
  new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function css(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      font-size: 13px; color: #1a1a1a; background: #fff; line-height: 1.55;
    }
    .page { max-width: 820px; margin: 0 auto; padding: 48px; }

    /* Header */
    .header { display: flex; justify-content: space-between; align-items: flex-start; }
    .header-left .co-name { font-size: 19px; font-weight: 700; }
    .header-left .co-tag  { font-size: 11px; color: #777; margin-top: 2px; }
    .header-left img { max-height: 56px; max-width: 160px; object-fit: contain; display: block; margin-bottom: 6px; }
    .header-right { text-align: right; font-size: 12px; color: #555; }
    .header-right .ref { font-weight: 700; color: #1a1a1a; font-size: 13px; margin-bottom: 2px; }
    .divider { height: 3px; background: #FF6B35; border-radius: 2px; margin: 14px 0 30px; }

    h1 { font-size: 23px; font-weight: 700; margin-bottom: 24px; }

    .label {
      font-size: 11px; font-weight: 700; letter-spacing: 0.09em;
      text-transform: uppercase; color: #FF6B35;
      margin-top: 26px; margin-bottom: 8px;
    }
    .body-text { font-size: 13px; color: #333; line-height: 1.6; }

    /* Table */
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
    thead th {
      background: #1a1a1a; color: #fff; padding: 10px 12px;
      font-size: 12px; font-weight: 600; text-align: left;
    }
    thead th.r { text-align: right; }
    tbody tr { border-bottom: 1px solid #ebebeb; }
    tbody td { padding: 10px 12px; vertical-align: top; }
    tbody td.r { text-align: right; white-space: nowrap; }

    /* Totals */
    .totals { margin-top: 6px; }
    .tot-row { display: flex; justify-content: flex-end; gap: 60px; padding: 5px 12px; font-size: 13px; color: #555; }
    .tot-row .amt { min-width: 90px; text-align: right; }
    .tot-row.grand {
      font-size: 16px; font-weight: 700; color: #1a1a1a;
      border-top: 2px solid #1a1a1a; margin-top: 6px; padding-top: 10px;
    }
    .tot-row.grand .amt { color: #FF6B35; }

    /* Photos */
    .photos-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px;
    }
    .photo-card { border: 1px solid #e2e2e2; border-radius: 7px; overflow: hidden; }
    .photo-card img {
      width: 100%; height: 210px; object-fit: cover; display: block; background: #f5f5f5;
    }
    .photo-meta { padding: 10px 12px; }
    .photo-area { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #FF6B35; }
    .photo-cap  { font-size: 12px; color: #555; margin-top: 3px; }

    /* Accept box */
    .accept-box {
      border: 2px solid #FF6B35; border-radius: 10px;
      padding: 24px; margin-top: 32px;
      background: rgba(255,107,53,0.04);
    }
    .accept-box .al { font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: #FF6B35; margin-bottom: 10px; }
    .accept-box p  { font-size: 13px; color: #555; margin-bottom: 16px; }
    .accept-btn {
      display: inline-block; background: #FF6B35; color: #fff !important;
      padding: 12px 28px; border-radius: 8px; font-weight: 700;
      font-size: 15px; text-decoration: none; margin-bottom: 12px;
    }
    .accept-url { font-size: 11px; color: #888; word-break: break-all; margin-top: 4px; }

    /* Signature */
    .sig-lines { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 32px; }
    .sig-line { border-top: 1px solid #555; padding-top: 6px; font-size: 11px; color: #666; }

    /* Screen-only print button */
    .print-btn {
      display: none;
    }

    @media screen {
      body { background: #e8e8e8; }
      .page { background: #fff; margin: 32px auto; box-shadow: 0 4px 32px rgba(0,0,0,0.14); border-radius: 4px; }
      .print-btn {
        display: block; position: fixed; top: 20px; right: 20px;
        background: #FF6B35; color: #fff; border: none;
        padding: 12px 22px; border-radius: 8px; font-size: 14px;
        font-weight: 700; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,0.25);
        z-index: 999;
      }
      .print-btn:hover { background: #e55a25; }
    }

    @media print {
      @page { margin: 14mm 16mm; size: A4; }
      body { background: #fff !important; }
      .print-btn { display: none !important; }
      .photo-card { page-break-inside: avoid; }
      .accept-box  { page-break-inside: avoid; }
      .sig-lines   { page-break-inside: avoid; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `
}

function wrap(body: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  <style>${css()}</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
  <div class="page">${body}</div>
</body>
</html>`
}

function header(company: CompanyProfile | null, reference: string): string {
  const name   = company?.name    || 'Brisbane Biohazard Cleaning'
  const tagline = company?.tagline || 'Professional Biohazard Remediation Services'
  const logo   = company?.logo_url
    ? `<img src="${esc(company.logo_url)}" alt="${esc(name)}">`
    : ''
  return `
    <div class="header">
      <div class="header-left">
        ${logo}
        <div class="co-name">${esc(name)}</div>
        <div class="co-tag">${esc(tagline)}</div>
      </div>
      <div class="header-right">
        <div class="ref">${esc(reference)}</div>
        <div>${todayStr()}</div>
      </div>
    </div>
    <div class="divider"></div>
  `
}

function section(lbl: string, text: string): string {
  if (!text?.trim()) return ''
  return `<div class="label">${esc(lbl)}</div><div class="body-text">${esc(text)}</div>`
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

// ── Quote ────────────────────────────────────────────────────────────────────

function buildQuoteHTML(
  content: QuoteContent,
  photos: Photo[],
  company: CompanyProfile | null,
  jobId: string,
  appUrl: string,
): string {
  const items = (content.line_items || []).map(item => `
    <tr>
      <td>${esc(item.description)}</td>
      <td class="r">${item.qty}</td>
      <td class="r">${esc(item.unit)}</td>
      <td class="r">${fmtMoney(item.rate)}</td>
      <td class="r">${fmtMoney(item.total)}</td>
    </tr>
  `).join('')

  const acceptUrl = `${appUrl}/accept/${jobId}`
  const beforePhotos = photos.filter(p => ['before', 'assessment'].includes(p.category))

  const body = `
    ${header(company, content.reference)}
    <h1>${esc(content.title)}</h1>

    <div class="label">Overview</div>
    <div class="body-text">${esc(content.intro)}</div>

    <div class="label">Scope &amp; Pricing</div>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="r">Qty</th>
          <th class="r">Unit</th>
          <th class="r">Rate</th>
          <th class="r">Total</th>
        </tr>
      </thead>
      <tbody>${items}</tbody>
    </table>

    <div class="totals">
      <div class="tot-row"><span>Subtotal</span><span class="amt">${fmtMoney(content.subtotal)}</span></div>
      ${content.gst > 0 ? `<div class="tot-row"><span>GST (10%)</span><span class="amt">${fmtMoney(content.gst)}</span></div>` : ''}
      <div class="tot-row grand"><span>TOTAL</span><span class="amt">${fmtMoney(content.total)}</span></div>
    </div>

    ${content.notes ? `${section('Notes &amp; Conditions', content.notes)}` : ''}
    ${section('Payment Terms', content.payment_terms)}
    ${section('Quote Validity', content.validity)}

    ${photoGrid(beforePhotos, 'Site Condition Photos')}

    <div class="accept-box">
      <div class="al">Accept This Quote Online</div>
      <p>Tap or click the button below to accept this quote online and we will be in touch to confirm your booking.</p>
      <a href="${esc(acceptUrl)}" class="accept-btn">✓ &nbsp;Accept This Quote</a>
      <div class="accept-url">${esc(acceptUrl)}</div>
    </div>

    <div class="label" style="margin-top:36px">Acceptance</div>
    <div class="body-text">To accept this quote, please sign below and return with deposit payment.</div>
    <div class="sig-lines">
      <div class="sig-line">Client Signature</div>
      <div class="sig-line">Date</div>
    </div>
  `
  return wrap(body, content.title)
}

// ── SOW ──────────────────────────────────────────────────────────────────────

function buildSOWHTML(
  content: SOWContent,
  photos: Photo[],
  company: CompanyProfile | null,
): string {
  const beforePhotos = photos.filter(p => ['before', 'assessment'].includes(p.category))

  const body = `
    ${header(company, content.reference)}
    <h1>${esc(content.title)}</h1>

    ${section('Executive Summary',  content.executive_summary)}
    ${section('Scope of Work',      content.scope)}
    ${section('Methodology',        content.methodology)}
    ${section('Safety Protocols',   content.safety_protocols)}
    ${section('Waste Disposal',     content.waste_disposal)}
    ${section('Timeline',           content.timeline)}
    ${section('Exclusions',         content.exclusions)}

    ${photoGrid(beforePhotos, 'Site Condition Photos')}

    ${section('Disclaimer', content.disclaimer)}

    <div class="label" style="margin-top:36px">Acceptance</div>
    <div class="body-text">${esc(content.acceptance)}</div>
    <div class="sig-lines">
      <div class="sig-line">Client Signature</div>
      <div class="sig-line">Date</div>
    </div>
  `
  return wrap(body, content.title)
}

// ── Report ────────────────────────────────────────────────────────────────────

function buildReportHTML(
  content: ReportContent,
  photos: Photo[],
  company: CompanyProfile | null,
): string {
  const beforePhotos = photos.filter(p => ['before', 'assessment'].includes(p.category))
  const duringPhotos = photos.filter(p => p.category === 'during')
  const afterPhotos  = photos.filter(p => p.category === 'after')

  const body = `
    ${header(company, content.reference)}
    <h1>${esc(content.title)}</h1>

    ${section('Executive Summary',         content.executive_summary)}
    ${section('Site Conditions on Arrival', content.site_conditions)}

    ${photoGrid(beforePhotos, 'Before Photos')}

    ${section('Works Carried Out',         content.works_carried_out)}
    ${section('Methodology',               content.methodology)}
    ${section('Products &amp; Equipment',  content.products_used)}
    ${section('Waste Disposal',            content.waste_disposal)}

    ${photoGrid(duringPhotos, 'During Works Photos')}

    ${section('Photo Record',              content.photo_record)}
    ${section('Outcome',                   content.outcome)}

    ${photoGrid(afterPhotos, 'Completion Photos')}

    <div class="label" style="margin-top:36px">Technician Sign-Off</div>
    <div class="body-text">${esc(content.technician_signoff)}</div>
    <div class="sig-lines">
      <div class="sig-line">Technician Signature</div>
      <div class="sig-line">Date</div>
    </div>
  `
  return wrap(body, content.title)
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function buildPrintHTML(
  type: DocType,
  content: object,
  photos: Photo[],
  company: CompanyProfile | null,
  jobId: string,
  appUrl: string,
): string {
  switch (type) {
    case 'quote':  return buildQuoteHTML(content as QuoteContent,  photos, company, jobId, appUrl)
    case 'sow':    return buildSOWHTML(content as SOWContent,   photos, company)
    case 'report': return buildReportHTML(content as ReportContent, photos, company)
    default:       return ''
  }
}
