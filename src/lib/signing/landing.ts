/*
 * lib/signing/landing.ts
 *
 * The first page of an open quote link, after the passcode or mobile number.
 * Built for a phone: the quote opens as a PDF in the phone's own viewer (which
 * zooms and scrolls the way people expect), and one large button starts
 * accepting it. The quote can still be opened on the page itself (?doc=1),
 * which is where signing happens, with the details step opened straight away
 * (?doc=1&start=sign).
 *
 * Plain HTML with one small script that records the visit. Nothing here is
 * trusted: the server checks everything again when they sign.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface LandingQuote {
  /** Its number on the link, from 1. */
  n: number
  /** e.g. "Contents Clearance Quote CCQ-20261114-1042". */
  label: string
  /** e.g. "$2,185.26". Null when the quote has no total. */
  totalLabel: string | null
}

export interface LandingData {
  token: string
  brandLabel: string
  toName: string
  siteAddress: string | null
  quotes: LandingQuote[]
  /** The whole of what is on the link, e.g. "$2,185.26". Null without totals or with one quote. */
  totalLabel: string | null
  /** e.g. { amountLabel: "$1,092.63", percentLabel: "50%" }. Null when there is no deposit. */
  deposit: { amountLabel: string; percentLabel: string } | null
  /** Where the quote PDF is on this host, before ?doc=. */
  pdfBase: string
  /** e.g. "14 December 2026". */
  expiresLabel: string
}

const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #e8eef7; color: #0f2447; font: 16px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; }
  .lp { max-width: 520px; margin: 0 auto; padding: 20px 16px 40px; }
  .lp-brand { font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #FF6B35; }
  h1 { font-size: 26px; line-height: 1.2; margin: 6px 0 6px; }
  .lp-lead { margin: 0 0 18px; color: #3a5070; }
  .lp-card { background: #fff; border-radius: 14px; padding: 16px; margin-bottom: 12px; box-shadow: 0 2px 10px rgba(15,36,71,0.08); }
  .lp-q-name { font-weight: 700; font-size: 17px; }
  .lp-q-total { font-size: 22px; font-weight: 800; margin: 4px 0 12px; }
  .lp-q-total small { font-size: 13px; font-weight: 600; color: #667085; }
  .lp-btn { display: block; width: 100%; text-align: center; text-decoration: none; border-radius: 12px; padding: 15px 16px; font-weight: 700; font-size: 17px; border: none; }
  .lp-btn-pdf { background: #fff; color: #0f2447; border: 2px solid #0f2447; }
  .lp-btn-go { background: #FF6B35; color: #fff; font-size: 19px; padding: 18px 16px; box-shadow: 0 6px 18px rgba(255,107,53,0.35); }
  .lp-alt { display: block; text-align: center; margin-top: 10px; font-size: 14px; color: #2563a8; }
  .lp-total { display: flex; justify-content: space-between; font-weight: 800; font-size: 18px; padding: 4px 2px 12px; }
  .lp-steps { list-style: none; padding: 0; margin: 18px 0 16px; }
  .lp-steps li { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 10px; color: #3a5070; }
  .lp-steps b { flex: 0 0 26px; height: 26px; border-radius: 50%; background: #0f2447; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; }
  .lp-note { font-size: 14px; color: #3a5070; margin: 12px 2px 0; }
  .lp-small { font-size: 13px; color: #667085; margin: 18px 2px 0; }
  .lp-small a { color: #667085; }
`

/** The page an open link shows first. */
export function signingLandingHtml(d: LandingData): string {
  const first = d.toName.trim().split(/\s+/)[0] || ''
  const several = d.quotes.length > 1
  const site = d.siteAddress?.trim()
  const pdf = (n: number) => `${d.pdfBase}${several ? `?doc=${n}` : ''}`
  const cards = d.quotes.map(q => `
    <div class="lp-card">
      <div class="lp-q-name">${esc(q.label)}</div>
      ${q.totalLabel ? `<div class="lp-q-total">${esc(q.totalLabel)} <small>inc GST</small></div>` : '<div style="height:12px"></div>'}
      <a class="lp-btn lp-btn-pdf" href="${esc(pdf(q.n))}" target="_blank" rel="noopener">View quote (PDF)</a>
      <a class="lp-alt" href="?doc=${q.n}">or read it on this page</a>
    </div>`).join('')
  const go = several
    ? `<a class="lp-btn lp-btn-go" href="?doc=1">Choose and sign</a>`
    : `<a class="lp-btn lp-btn-go" href="?doc=1&amp;start=sign">Accept and sign</a>`
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(d.brandLabel)}</title>
  <style>${CSS}</style>
</head>
<body>
  <main class="lp">
    <div class="lp-brand">${esc(d.brandLabel)}</div>
    <h1>${several ? 'Your quotes' : 'Your quote'}</h1>
    <p class="lp-lead">${first ? `Hi ${esc(first)}. ` : ''}Here ${several ? 'are your quotes' : 'is your quote'}${site ? ` for ${esc(site)}` : ''}. Have a read, then accept ${several ? 'the ones you want' : 'it'} on this page.</p>
    ${cards}
    ${d.totalLabel ? `<div class="lp-total"><span>Total</span><span>${esc(d.totalLabel)}</span></div>` : ''}
    <ol class="lp-steps">
      <li><b>1</b><span>Read the quote. It opens as a PDF${several ? '' : ' (on some phones it downloads: open it from the download notice)'}.</span></li>
      <li><b>2</b><span>${several ? 'Choose Accept or Decline for each quote, then give' : 'Press Accept and sign, then give'} your details: name, date of birth and home address. About 2 minutes.</span></li>
      <li><b>3</b><span>Sign with your finger, or type your name.${d.deposit ? ' Then pay the deposit.' : ''}</span></li>
    </ol>
    ${go}
    ${d.deposit ? `<p class="lp-note">A deposit of <strong>${esc(d.deposit.amountLabel)}</strong> (${esc(d.deposit.percentLabel)}) is paid after you sign. We will show you how.</p>` : ''}
    <p class="lp-small">${several ? '' : `Not going ahead? <a href="?doc=1&amp;start=decline">Decline the quote</a>. `}This link works until ${esc(d.expiresLabel)}. Questions? Reply to our text or call ${esc(d.brandLabel)}.</p>
  </main>
  <script type="application/json" id="lp-config">${JSON.stringify({ api: `/api/sign/${d.token}` }).replace(/</g, '\\u003c')}</script>
  <script>
    (function () {
      var cfg = JSON.parse(document.getElementById('lp-config').textContent);
      fetch(cfg.api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'view' }) }).catch(function () {});
    })();
  </script>
</body>
</html>`
}
