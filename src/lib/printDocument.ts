import type {
  DocType, Photo, CompanyProfile,
  QuoteContent, SOWContent, SWMSContent, AuthorityToProceedContent,
  EngagementAgreementContent, ReportContent, CertificateOfDecontaminationContent,
  WasteDisposalManifestContent, JSAContent, NDAContent, RiskAssessmentContent,
  WorkStep, RiskRow, WasteItem,
} from './types'

const fmtMoney = (n: number) =>
  '$' + Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const todayStr = () =>
  new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

// ── Shared CSS ────────────────────────────────────────────────────────────────

function css(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; line-height: 1.55; }
    .page { max-width: 820px; margin: 0 auto; padding: 48px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; }
    .header-left .co-name { font-size: 19px; font-weight: 700; }
    .header-left .co-tag  { font-size: 11px; color: #777; margin-top: 2px; }
    .header-left img { max-height: 56px; max-width: 160px; object-fit: contain; display: block; margin-bottom: 6px; }
    .header-right { text-align: right; font-size: 12px; color: #555; }
    .header-right .ref { font-weight: 700; color: #1a1a1a; font-size: 13px; margin-bottom: 2px; }
    .divider { height: 3px; background: #FF6B35; border-radius: 2px; margin: 14px 0 30px; }
    h1 { font-size: 23px; font-weight: 700; margin-bottom: 24px; }
    .label { font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: #FF6B35; margin-top: 26px; margin-bottom: 8px; }
    .body-text { font-size: 13px; color: #333; line-height: 1.6; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
    thead th { background: #1a1a1a; color: #fff; padding: 10px 12px; font-size: 12px; font-weight: 600; text-align: left; }
    thead th.r { text-align: right; }
    tbody tr { border-bottom: 1px solid #ebebeb; }
    tbody td { padding: 10px 12px; vertical-align: top; }
    tbody td.r { text-align: right; white-space: nowrap; }
    tbody tr:nth-child(even) { background: #fafafa; }
    .totals { margin-top: 6px; }
    .tot-row { display: flex; justify-content: flex-end; gap: 60px; padding: 5px 12px; font-size: 13px; color: #555; }
    .tot-row .amt { min-width: 90px; text-align: right; }
    .tot-row.grand { font-size: 16px; font-weight: 700; color: #1a1a1a; border-top: 2px solid #1a1a1a; margin-top: 6px; padding-top: 10px; }
    .tot-row.grand .amt { color: #FF6B35; }
    .photos-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px; }
    .photo-card { border: 1px solid #e2e2e2; border-radius: 7px; overflow: hidden; }
    .photo-card img { width: 100%; height: 210px; object-fit: cover; display: block; background: #f5f5f5; }
    .photo-meta { padding: 10px 12px; }
    .photo-area { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #FF6B35; }
    .photo-cap  { font-size: 12px; color: #555; margin-top: 3px; }
    .accept-box { border: 2px solid #FF6B35; border-radius: 10px; padding: 24px; margin-top: 32px; background: rgba(255,107,53,0.04); }
    .accept-box .al { font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: #FF6B35; margin-bottom: 10px; }
    .accept-box p  { font-size: 13px; color: #555; margin-bottom: 16px; }
    .accept-btn { display: inline-block; background: #FF6B35; color: #fff !important; padding: 12px 28px; border-radius: 8px; font-weight: 700; font-size: 15px; text-decoration: none; margin-bottom: 12px; }
    .accept-url { font-size: 11px; color: #888; word-break: break-all; margin-top: 4px; }
    .sig-lines { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 32px; }
    .sig-line { border-top: 1px solid #555; padding-top: 6px; font-size: 11px; color: #666; }
    /* Risk / step tables */
    .risk-H { color: #dc2626; font-weight: 700; }
    .risk-M { color: #d97706; font-weight: 700; }
    .risk-L { color: #16a34a; font-weight: 700; }
    /* Action bar */
    .action-bar { display: none; }
    @media screen {
      body { background: #e8e8e8; }
      .page { background: #fff; margin: 80px auto 40px; box-shadow: 0 4px 32px rgba(0,0,0,0.14); border-radius: 4px; }
      .action-bar {
        display: flex; gap: 10px; align-items: center;
        position: fixed; top: 0; left: 0; right: 0; z-index: 999;
        background: #1a1a1a; padding: 12px 20px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      }
      .action-bar .doc-title { color: #fff; font-size: 13px; font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ab-btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 8px 14px; border-radius: 7px; font-size: 13px; font-weight: 600;
        text-decoration: none; cursor: pointer; border: none; white-space: nowrap;
        flex-shrink: 0;
      }
      .ab-primary { background: #FF6B35; color: #fff; }
      .ab-secondary { background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); }
      .ab-secondary:hover { background: rgba(255,255,255,0.2); }
    }
    @media print {
      @page { margin: 14mm 16mm; size: A4; }
      body { background: #fff !important; }
      .action-bar { display: none !important; }
      .photo-card { page-break-inside: avoid; }
      .accept-box  { page-break-inside: avoid; }
      .sig-lines   { page-break-inside: avoid; }
      tr { page-break-inside: avoid; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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

function actionBar(docTitle: string, client: ClientInfo | undefined): string {
  const url   = client?.printUrl ?? ''
  const email = client?.client_email ?? ''
  const phone = (client?.client_phone ?? '').replace(/\s/g,'')
  const name  = client?.client_name ?? ''
  const subject = encodeURIComponent(`${docTitle} — ${name}`)
  const body    = encodeURIComponent(`Hi ${name.split(' ')[0]},\n\nPlease find your document at the link below:\n\n${url}\n\nKind regards`)

  return `
    <div class="action-bar">
      <span class="doc-title">${esc(docTitle)} — ${esc(name)}</span>
      <button class="ab-btn ab-primary" onclick="window.print()">🖨 Print / Save PDF</button>
      ${email ? `<a class="ab-btn ab-secondary" href="mailto:${esc(email)}?subject=${subject}&body=${body}">✉️ Email</a>` : ''}
      ${phone ? `<a class="ab-btn ab-secondary" href="sms:${esc(phone)}&body=${encodeURIComponent(`Hi ${name.split(' ')[0]}, here is your document: ${url}`)}">💬 Text Link</a>` : ''}
      <button class="ab-btn ab-secondary" onclick="navigator.clipboard.writeText('${esc(url)}').then(()=>{this.textContent='✓ Copied';setTimeout(()=>this.textContent='🔗 Copy Link',2000)})">🔗 Copy Link</button>
    </div>
  `
}

// ── Wrap ──────────────────────────────────────────────────────────────────────

function wrap(body: string, title: string, client?: ClientInfo): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  <style>${css()}</style>
</head>
<body>
  ${actionBar(title, client)}
  <div class="page">${body}</div>
</body>
</html>`
}

// ── Shared fragments ──────────────────────────────────────────────────────────

function header(company: CompanyProfile | null, reference: string): string {
  const name    = company?.name    || 'Brisbane Biohazard Cleaning'
  const tagline = company?.tagline || 'Professional Biohazard Remediation Services'
  const logo    = company?.logo_url ? `<img src="${esc(company.logo_url)}" alt="${esc(name)}">` : ''
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
        ${company?.abn ? `<div style="margin-top:2px">ABN ${esc(company.abn)}</div>` : ''}
        ${company?.phone ? `<div>${esc(company.phone)}</div>` : ''}
      </div>
    </div>
    <div class="divider"></div>
  `
}

function section(lbl: string, text: string): string {
  if (!text?.trim()) return ''
  return `<div class="label">${lbl}</div><div class="body-text">${esc(text)}</div>`
}

function sigBlock(text?: string): string {
  return `
    ${text ? `<div class="label" style="margin-top:36px">Acceptance</div><div class="body-text">${esc(text)}</div>` : ''}
    <div class="sig-lines">
      <div class="sig-line">Authorised Signature</div>
      <div class="sig-line">Date</div>
    </div>
  `
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

function buildQuoteHTML(c: QuoteContent, photos: Photo[], company: CompanyProfile | null, jobId: string, appUrl: string, client?: ClientInfo): string {
  const acceptUrl = `${appUrl}/accept/${jobId}`
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

  return wrap(`
    ${header(company, c.reference)}
    <h1>${esc(c.title)}</h1>
    <div class="label">Overview</div><div class="body-text">${esc(c.intro)}</div>
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
    ${c.include_photos !== false ? photoGrid(before, 'Site Condition Photos') : ''}
    <div class="accept-box">
      <div class="al">Accept This Quote Online</div>
      <p>Tap or click the button below to accept this quote online and we will be in touch to confirm your booking.</p>
      <a href="${esc(acceptUrl)}" class="accept-btn">✓ &nbsp;Accept This Quote</a>
      <div class="accept-url">${esc(acceptUrl)}</div>
    </div>
    ${sigBlock('To accept this quote, please sign below and return with deposit payment.')}
  `, c.title, client)
}

// ── 2. SOW ────────────────────────────────────────────────────────────────────

function buildSOWHTML(c: SOWContent, photos: Photo[], company: CompanyProfile | null, client?: ClientInfo): string {
  const before = photos.filter(p => ['before','assessment'].includes(p.category))
  return wrap(`
    ${header(company, c.reference)}
    <h1>${esc(c.title)}</h1>
    ${section('Executive Summary', c.executive_summary)}
    ${section('Scope of Work', c.scope)}
    ${section('Methodology', c.methodology)}
    ${section('Safety Protocols', c.safety_protocols)}
    ${section('Waste Disposal', c.waste_disposal)}
    ${section('Timeline', c.timeline)}
    ${section('Exclusions', c.exclusions)}
    ${c.include_photos !== false ? photoGrid(before, 'Site Condition Photos') : ''}
    ${section('Disclaimer', c.disclaimer)}
    ${sigBlock(c.acceptance)}
  `, c.title, client)
}

// ── 3. SWMS ───────────────────────────────────────────────────────────────────

function buildSWMSHTML(c: SWMSContent, company: CompanyProfile | null, client?: ClientInfo): string {
  return wrap(`
    ${header(company, c.reference)}
    <h1>${esc(c.title)}</h1>
    ${section('Project Details', c.project_details)}
    <div class="label">Work Steps, Hazards &amp; Controls</div>
    ${stepsTable(c.steps)}
    ${section('PPE Required', c.ppe_required)}
    ${section('Emergency Procedures', c.emergency_procedures)}
    ${section('Legislation &amp; References', c.legislation_references)}
    <div class="label">Worker Declarations</div>
    <div class="body-text">${esc(c.declarations)}</div>
    <table style="margin-top:16px">
      <thead><tr><th>Name</th><th>Signature</th><th>Date</th><th>Company</th></tr></thead>
      <tbody>
        ${[1,2,3,4].map(()=>'<tr><td style="padding:18px 12px"></td><td></td><td></td><td></td></tr>').join('')}
      </tbody>
    </table>
  `, c.title, client)
}

// ── 4. Authority to Proceed ───────────────────────────────────────────────────

function buildATPHTML(c: AuthorityToProceedContent, company: CompanyProfile | null, client?: ClientInfo): string {
  return wrap(`
    ${header(company, c.reference)}
    <h1>${esc(c.title)}</h1>
    ${section('Scope of Works Authorised', c.scope_summary)}
    ${section('Site Access Details', c.access_details)}
    ${section('Special Conditions', c.special_conditions)}
    ${section('Liability Acknowledgment', c.liability_acknowledgment)}
    ${section('Payment Authorisation', c.payment_authorisation)}
    ${sigBlock(c.acceptance)}
  `, c.title, client)
}

// ── 5. Engagement Agreement ───────────────────────────────────────────────────

function buildEngagementHTML(c: EngagementAgreementContent, company: CompanyProfile | null, client?: ClientInfo): string {
  return wrap(`
    ${header(company, c.reference)}
    <h1>${esc(c.title)}</h1>
    ${section('Parties', c.parties)}
    ${section('Services', c.services_description)}
    ${section('Fees &amp; Payment', c.fees_and_payment)}
    ${section('Limitation of Liability', c.liability_limitations)}
    ${section('Confidentiality', c.confidentiality)}
    ${section('Dispute Resolution', c.dispute_resolution)}
    ${section('Termination', c.termination)}
    ${section('Governing Law', c.governing_law)}
    ${sigBlock(c.acceptance)}
  `, c.title, client)
}

// ── 6. Completion Report ──────────────────────────────────────────────────────

function buildReportHTML(c: ReportContent, photos: Photo[], company: CompanyProfile | null, client?: ClientInfo): string {
  const before = photos.filter(p => ['before','assessment'].includes(p.category))
  const during = photos.filter(p => p.category === 'during')
  const after  = photos.filter(p => p.category === 'after')
  return wrap(`
    ${header(company, c.reference)}
    <h1>${esc(c.title)}</h1>
    ${section('Executive Summary', c.executive_summary)}
    ${section('Site Conditions on Arrival', c.site_conditions)}
    ${photoGrid(before, 'Before Photos')}
    ${section('Works Carried Out', c.works_carried_out)}
    ${section('Methodology', c.methodology)}
    ${section('Products &amp; Equipment Used', c.products_used)}
    ${section('Waste Disposal', c.waste_disposal)}
    ${c.include_photos !== false ? photoGrid(during, 'During Works Photos') : ''}
    ${section('Photo Record', c.photo_record)}
    ${section('Outcome', c.outcome)}
    ${c.include_photos !== false ? photoGrid(after, 'Completion Photos') : ''}
    ${sigBlock(c.technician_signoff)}
  `, c.title, client)
}

// ── 7. Certificate of Decontamination ─────────────────────────────────────────

function buildCODHTML(c: CertificateOfDecontaminationContent, company: CompanyProfile | null, client?: ClientInfo): string {
  return wrap(`
    ${header(company, c.reference)}
    <h1>${esc(c.title)}</h1>
    <div style="margin-bottom:24px">
      <div class="label">Date of Works</div><div class="body-text">${esc(c.date_of_works)}</div>
    </div>
    ${section('Works Summary', c.works_summary)}
    ${section('Decontamination Standard', c.decontamination_standard)}
    ${section('Products Used', c.products_used)}
    <div style="margin:32px 0;padding:24px;background:#f0fdf4;border:2px solid #16a34a;border-radius:10px">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:#16a34a;margin-bottom:10px">Outcome</div>
      <div style="font-size:14px;color:#15803d;font-weight:600;line-height:1.5">${esc(c.outcome_statement)}</div>
    </div>
    ${section('Limitations', c.limitations)}
    <div style="margin-top:32px;padding:20px;background:#f8f8f8;border-radius:8px;font-size:12px;color:#555">
      ${esc(c.certifier_statement)}
    </div>
    ${sigBlock()}
  `, c.title, client)
}

// ── 8. Waste Disposal Manifest ────────────────────────────────────────────────

function buildWDMHTML(c: WasteDisposalManifestContent, company: CompanyProfile | null, client?: ClientInfo): string {
  return wrap(`
    ${header(company, c.reference)}
    <h1>${esc(c.title)}</h1>
    <div class="label">Collection Date</div><div class="body-text">${esc(c.collection_date)}</div>
    <div class="label">Waste Items</div>
    ${wasteTable(c.waste_items)}
    ${section('Transport Details', c.transport_details)}
    <div style="margin-top:32px;padding:20px;background:#f8f8f8;border-radius:8px;font-size:12px;color:#555">
      <strong>Declaration:</strong> ${esc(c.declaration)}
    </div>
    ${sigBlock()}
  `, c.title, client)
}

// ── 9. JSA ────────────────────────────────────────────────────────────────────

function buildJSAHTML(c: JSAContent, company: CompanyProfile | null, client?: ClientInfo): string {
  return wrap(`
    ${header(company, c.reference)}
    <h1>${esc(c.title)}</h1>
    ${section('Job Description', c.job_description)}
    <div class="label">Steps, Hazards &amp; Controls</div>
    ${stepsTable(c.steps)}
    ${section('PPE Required', c.ppe_required)}
    ${section('Emergency Contacts', c.emergency_contacts)}
    <div class="label">Worker Sign-Off</div>
    <div class="body-text">${esc(c.sign_off)}</div>
    <table style="margin-top:16px">
      <thead><tr><th>Name</th><th>Signature</th><th>Date</th></tr></thead>
      <tbody>
        ${[1,2,3,4].map(()=>'<tr><td style="padding:18px 12px"></td><td></td><td></td></tr>').join('')}
      </tbody>
    </table>
  `, c.title, client)
}

// ── 10. NDA ───────────────────────────────────────────────────────────────────

function buildNDAHTML(c: NDAContent, company: CompanyProfile | null, client?: ClientInfo): string {
  return wrap(`
    ${header(company, c.reference)}
    <h1>${esc(c.title)}</h1>
    ${section('Parties', c.parties)}
    ${section('Confidential Information', c.confidential_information_definition)}
    ${section('Obligations', c.obligations)}
    ${section('Exceptions', c.exceptions)}
    ${section('Term', c.term)}
    ${section('Remedies', c.remedies)}
    ${section('Governing Law', c.governing_law)}
    ${sigBlock(c.acceptance)}
  `, c.title, client)
}

// ── 11. Risk Assessment ───────────────────────────────────────────────────────

function buildRAHTML(c: RiskAssessmentContent, company: CompanyProfile | null, client?: ClientInfo): string {
  return wrap(`
    ${header(company, c.reference)}
    <h1>${esc(c.title)}</h1>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px">
      <div><div class="label">Site</div><div class="body-text">${esc(c.site_description)}</div></div>
      <div><div class="label">Date</div><div class="body-text">${esc(c.assessment_date)}</div></div>
      <div><div class="label">Assessor</div><div class="body-text">${esc(c.assessor)}</div></div>
    </div>
    <div class="label">Risk Register</div>
    ${riskTable(c.risks)}
    <div style="margin:20px 0;padding:16px;background:#f8f8f8;border-radius:8px">
      <strong>Overall Risk Rating: </strong>${riskBadge(c.overall_risk_rating)}
    </div>
    ${section('Recommendations', c.recommendations)}
    ${section('Review Date', c.review_date)}
    ${sigBlock()}
  `, c.title, client)
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function buildPrintHTML(
  type: DocType,
  content: Record<string, unknown>,
  photos: Photo[],
  company: CompanyProfile | null,
  jobId: string,
  appUrl: string,
  client?: ClientInfo,
): string {
  const c = content as Record<string, unknown>
  switch (type) {
    case 'quote':                      return buildQuoteHTML(c as unknown as QuoteContent, photos, company, jobId, appUrl, client)
    case 'sow':                        return buildSOWHTML(c as unknown as SOWContent, photos, company, client)
    case 'swms':                       return buildSWMSHTML(c as unknown as SWMSContent, company, client)
    case 'authority_to_proceed':       return buildATPHTML(c as unknown as AuthorityToProceedContent, company, client)
    case 'engagement_agreement':       return buildEngagementHTML(c as unknown as EngagementAgreementContent, company, client)
    case 'report':                     return buildReportHTML(c as unknown as ReportContent, photos, company, client)
    case 'certificate_of_decontamination': return buildCODHTML(c as unknown as CertificateOfDecontaminationContent, company, client)
    case 'waste_disposal_manifest':    return buildWDMHTML(c as unknown as WasteDisposalManifestContent, company, client)
    case 'jsa':                        return buildJSAHTML(c as unknown as JSAContent, company, client)
    case 'nda':                        return buildNDAHTML(c as unknown as NDAContent, company, client)
    case 'risk_assessment':            return buildRAHTML(c as unknown as RiskAssessmentContent, company, client)
    default:                           return '<body><p>Unknown document type</p></body>'
  }
}
