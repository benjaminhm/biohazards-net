/*
 * lib/signing/shell.ts
 *
 * What the client sees around the document on their private link. The link is
 * a funnel with the document first:
 *
 *   1 View          the document opens straight away, nothing in front of it
 *   2 Your details  who is signing and in what capacity, where they live and
 *                   how to reach them, and a declaration that it is true. What
 *                   they type is checked by the server (lib/signing/details.ts)
 *   3 Sign          asks them to agree to sign electronically, then lights up
 *                   the fields: draw or type a signature, Finish. The name in
 *                   the document is the legal name from their details
 *   4 Pay deposit   once signed, "your invoice is being prepared" until staff
 *                   have checked the signed document and approved the invoice
 *                   in Xero; then the amount with Pay by card and the bank
 *                   transfer details together
 *
 * The pay step is left out when the request has no deposit.
 *
 * A link can carry several quotes. Each is its own page (?doc=2) with a strip
 * to move between them, and step 1 becomes Choose: Accept or Decline each
 * quote, then a review of the choices with the accepted total. They then give
 * their details and sign once, in a quote they accepted; the server places the
 * signature on every accepted quote. Declining every quote declines the link.
 *
 * It is plain HTML, CSS and script added to the document page (the document is
 * already a complete HTML page, not a React screen), so it works on any phone
 * browser with nothing to load first. Nothing here is trusted: the server
 * checks every value again in /api/sign/[token].
 */
import { depositPartPaid, depositSettled, longDate, money, percentLabel } from '@/lib/signing/pay'
import type { PayPanel } from '@/lib/signing/pay'
import { CAPACITIES, STATES, companyRule, declarationText } from '@/lib/signing/details'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** JSON that is safe to place inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

const SHELL_CSS = `
  #sg-root, #sg-root * { box-sizing: border-box; }
  #sg-root {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
    font-size: 15px; line-height: 1.45; color: #111;
  }
  #sg-root button { font: inherit; cursor: pointer; }
  #sg-root button:disabled { opacity: 0.5; cursor: default; }
  #sg-bar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 1000; height: 56px;
    display: flex; align-items: center; gap: 12px; padding: 0 16px;
    background: #0f2447; color: #fff; box-shadow: 0 2px 10px rgba(0,0,0,0.25);
  }
  #sg-bar .sg-doc { flex: 1; min-width: 0; }
  #sg-bar .sg-brand { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #sg-bar .sg-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #sg-bar .sg-progress { font-size: 13px; opacity: 0.85; white-space: nowrap; }
  #sg-root .sg-btn {
    border: none; border-radius: 8px; padding: 10px 18px; font-weight: 700; white-space: nowrap;
    background: #FF6B35; color: #fff;
  }
  #sg-root .sg-btn-quiet { background: transparent; color: inherit; border: 1px solid rgba(127,127,127,0.5); font-weight: 600; }
  #sg-bar .sg-btn-quiet { color: #fff; border-color: rgba(255,255,255,0.35); padding: 9px 12px; }
  #sg-root a.sg-btn { text-decoration: none; display: inline-block; text-align: center; }
  #sg-root .sg-btn-wide { display: block; width: 100%; padding: 14px; font-size: 16px; }
  /* The steps, under the bar */
  #sg-steps {
    position: fixed; top: 56px; left: 0; right: 0; z-index: 999; height: 30px; margin: 0; padding: 0 12px;
    display: flex; align-items: center; justify-content: center; gap: 22px; list-style: none;
    background: #e8eef7; color: #667085; font-size: 12px; font-weight: 600; border-bottom: 1px solid #c9d5e6;
  }
  #sg-steps li { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  #sg-steps li b {
    display: inline-flex; width: 18px; height: 18px; border-radius: 50%; align-items: center; justify-content: center;
    background: #c9d5e6; color: #0f2447; font-size: 11px;
  }
  #sg-steps li.sg-now { color: #0f2447; }
  #sg-steps li.sg-now b { background: #FF6B35; color: #fff; }
  #sg-steps li.sg-done b { background: #12805c; color: #fff; }
  /* Room for the bar and the steps above the document. */
  @media screen { body, body.sow-print-body { padding-top: 86px; } }
  /* Several quotes on one link: which is in view, and what was chosen for each */
  #sg-quotes {
    position: fixed; top: 86px; left: 0; right: 0; z-index: 998; height: 42px; margin: 0; padding: 0 12px;
    display: flex; align-items: center; gap: 8px; overflow-x: auto; white-space: nowrap;
    background: #fff; border-bottom: 1px solid #c9d5e6;
  }
  #sg-quotes .sg-q {
    display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; padding: 5px 11px; border-radius: 999px;
    border: 1px solid #c9d5e6; background: #fff; color: #0f2447; font-size: 12px; font-weight: 600; text-decoration: none;
  }
  #sg-quotes .sg-q.sg-here { background: #0f2447; border-color: #0f2447; color: #fff; }
  #sg-quotes .sg-q.sg-off { opacity: 0.65; }
  #sg-quotes .sg-q-state { font-weight: 700; color: #667085; }
  #sg-quotes .sg-q-state.sg-yes { color: #12805c; }
  #sg-quotes .sg-q-state.sg-no { color: #b91c1c; }
  #sg-quotes .sg-here .sg-q-state { color: #c9d5e6; }
  #sg-quotes .sg-here .sg-q-state.sg-yes { color: #7be0b5; }
  #sg-quotes .sg-here .sg-q-state.sg-no { color: #ffb4b4; }
  #sg-root .sg-choices { border: 1px solid #e4e7ec; border-radius: 10px; overflow: hidden; margin: 0 0 12px; }
  #sg-root .sg-choice { display: flex; align-items: baseline; gap: 10px; padding: 10px 12px; }
  #sg-root .sg-choice + .sg-choice { border-top: 1px solid #e4e7ec; }
  #sg-root .sg-choice-name { flex: 1; min-width: 0; font-weight: 600; word-break: break-word; }
  #sg-root .sg-choice-name small { display: block; font-weight: 400; color: #667085; font-size: 13px; }
  #sg-root .sg-choice .sg-yes { color: #12805c; font-weight: 700; white-space: nowrap; }
  #sg-root .sg-choice .sg-no { color: #b91c1c; font-weight: 700; white-space: nowrap; }
  #sg-root .sg-total { font-size: 17px; font-weight: 700; margin: 0 0 6px; font-variant-numeric: tabular-nums; }
  #sg-root .sg-overlay {
    position: fixed; inset: 0; z-index: 1100; display: none;
    align-items: center; justify-content: center; padding: 16px;
    background: rgba(15, 36, 71, 0.6); overflow-y: auto;
  }
  #sg-root .sg-overlay.sg-on { display: flex; }
  #sg-root .sg-card {
    width: 100%; max-width: 480px; background: #fff; border-radius: 14px; padding: 24px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.35); max-height: 100%; overflow-y: auto;
  }
  #sg-root .sg-card h2 { font-size: 20px; margin: 0 0 8px; }
  #sg-root .sg-card p { margin: 0 0 12px; color: #333; }
  #sg-root .sg-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #FF6B35; margin-bottom: 6px; }
  #sg-root .sg-facts { background: #f5f7fa; border-radius: 10px; padding: 12px 14px; margin: 0 0 16px; font-size: 14px; }
  #sg-root .sg-facts div + div { margin-top: 4px; }
  #sg-root .sg-facts span { color: #666; }
  #sg-root .sg-check { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 18px; font-size: 14px; cursor: pointer; }
  #sg-root .sg-check input { width: 20px; height: 20px; margin: 1px 0 0; flex-shrink: 0; }
  #sg-root .sg-actions { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
  #sg-root .sg-small { font-size: 12px; color: #666; }
  #sg-root .sg-error { color: #b91c1c; font-size: 13px; min-height: 18px; margin: 8px 0 0; }
  #sg-root .sg-tabs { display: flex; gap: 6px; margin: 0 0 12px; }
  #sg-root .sg-tab { flex: 1; padding: 9px; border-radius: 8px; border: 1px solid #d0d5dd; background: #fff; color: #111; font-weight: 600; }
  #sg-root .sg-tab.sg-on { background: #0f2447; border-color: #0f2447; color: #fff; }
  #sg-root .sg-pad {
    position: relative; border: 1px dashed #98a2b3; border-radius: 10px; background: #fcfcfd; height: 180px; overflow: hidden;
  }
  #sg-root .sg-pad canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
  #sg-root .sg-pad .sg-line { position: absolute; left: 16px; right: 16px; bottom: 42px; border-bottom: 1px solid #d0d5dd; pointer-events: none; }
  #sg-root .sg-pad .sg-hint { position: absolute; left: 0; right: 0; bottom: 14px; text-align: center; font-size: 12px; color: #98a2b3; pointer-events: none; }
  #sg-root .sg-input {
    width: 100%; padding: 11px 12px; border: 1px solid #d0d5dd; border-radius: 8px; font: inherit; font-size: 16px; margin: 0 0 10px;
  }
  #sg-root textarea.sg-input { min-height: 96px; resize: vertical; }
  /* Your details */
  #sg-root select.sg-input { background: #fff; color: #111; height: 46px; }
  #sg-root .sg-card-wide { max-width: 560px; }
  #sg-root .sg-label { display: block; font-size: 13px; font-weight: 600; color: #344054; margin: 0 0 4px; }
  #sg-root .sg-label small { font-weight: 400; color: #667085; font-size: 12px; }
  #sg-root .sg-row { display: flex; gap: 10px; }
  #sg-root .sg-row > * { flex: 1 1 0; min-width: 0; }
  #sg-root .sg-row > .sg-narrow { flex: 0 0 112px; }
  #sg-root .sg-input.sg-bad { border-color: #b91c1c; box-shadow: 0 0 0 3px rgba(185, 28, 28, 0.15); }
  #sg-root .sg-group { border-top: 1px solid #e4e7ec; margin: 6px 0 0; padding: 14px 0 0; }
  #sg-root .sg-declare { background: #f5f7fa; border-radius: 10px; padding: 12px 14px; margin: 6px 0 0; }
  #sg-root .sg-declare .sg-check { margin: 0; }
  .sow-root .sign-block .sign-slot.sg-name-slot { cursor: pointer; }
  #sg-root .sg-typed {
    border: 1px dashed #98a2b3; border-radius: 10px; background: #fcfcfd; height: 110px;
    display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 0 12px;
    font: italic 44px 'Snell Roundhand', 'Brush Script MT', 'Segoe Script', 'Lucida Handwriting', 'Apple Chancery', cursive;
    white-space: nowrap;
  }
  /* Pay deposit */
  #sg-root .sg-amount { font-size: 32px; font-weight: 800; letter-spacing: -0.01em; margin: 2px 0; font-variant-numeric: tabular-nums; }
  #sg-root .sg-card h3 { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #475467; margin: 18px 0 8px; }
  #sg-root .sg-bank { border: 1px solid #e4e7ec; border-radius: 10px; overflow: hidden; margin: 0 0 10px; }
  #sg-root .sg-bank-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; }
  #sg-root .sg-bank-row + .sg-bank-row { border-top: 1px solid #e4e7ec; }
  #sg-root .sg-bank-row span { flex: 0 0 108px; font-size: 13px; color: #667085; }
  #sg-root .sg-bank-row strong { flex: 1; min-width: 0; font-size: 16px; word-break: break-word; font-variant-numeric: tabular-nums; }
  #sg-root .sg-copy { border: 1px solid #d0d5dd; background: #fff; color: #0f2447; border-radius: 6px; padding: 5px 10px; font-size: 12px; font-weight: 600; }
  #sg-root .sg-note { background: #f5f7fa; border-radius: 10px; padding: 10px 12px; font-size: 13px; color: #333; margin: 0 0 12px; }
  #sg-root .sg-good { background: #e7f6ef; color: #0b5f43; border-radius: 10px; padding: 12px 14px; font-size: 15px; margin: 0 0 12px; }
  #sg-toast {
    position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 1200; display: none;
    background: #b91c1c; color: #fff; padding: 12px 16px; border-radius: 10px; max-width: calc(100% - 32px);
    box-shadow: 0 8px 30px rgba(0,0,0,0.3); font-size: 14px;
  }
  /* Fields lit up inside the document */
  .sow-root .sign-block.sg-live { border-color: #FF6B35; box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.18); }
  .sow-root .sign-block .sign-slot.sg-todo {
    background: #fff4c2; border: 2px solid #f5b800; border-radius: 6px; cursor: pointer;
    align-items: center; justify-content: center; padding: 4px;
  }
  .sow-root .sign-block .sign-slot.sg-todo:focus { outline: 3px solid rgba(255, 107, 53, 0.6); outline-offset: 2px; }
  .sow-root .sign-block .sign-slot .sg-tag {
    font: 700 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #7a5200; letter-spacing: 0.02em;
  }
  .sow-root .sign-block .sign-slot.sg-done { cursor: pointer; }
  .sow-root .sign-block .sign-slot.sg-name-slot { background: #f5f9ff; border-radius: 6px 6px 0 0; }
  /* Phones: the A4 sheet is scaled to the screen width (see FIT_SCRIPT), so give the fields more room. */
  @media screen and (max-width: 640px) {
    .sow-root .sign-block .sign-slot { min-height: 120px; font-size: 17pt; }
    .sow-root .sign-block .sign-slot img { max-height: 110px; }
    .sow-root .sign-block .sign-slot .sg-tag { font-size: 26px; }
    .sow-root .sign-block .sign-cap { font-size: 12pt; }
  }
  @media (max-width: 560px) {
    #sg-bar { gap: 8px; padding: 0 10px; }
    #sg-bar .sg-progress { display: none; }
    #sg-bar .sg-wide { display: none; }
    #sg-steps { gap: 10px; font-size: 11px; padding: 0 6px; }
    #sg-root .sg-card { padding: 20px 18px; }
    #sg-root .sg-row { flex-wrap: wrap; }
    #sg-root .sg-row > .sg-first { flex: 1 1 100%; }
    #sg-root .sg-row > .sg-narrow { flex: 1 1 0; }
    #sg-root .sg-bank-row span { flex-basis: 92px; }
  }
  @media print { #sg-root { display: none !important; } }
`

/** With several quotes there is a third strip under the steps, so the document starts lower. */
const SEVERAL_CSS = `
  @media screen { body, body.sow-print-body { padding-top: 128px; } }
`

/*
 * The document is an A4 sheet (210mm wide). On a phone that is wider than the
 * screen, which pushes the bar and the pop-up windows off to the side. Scale
 * the sheet to the screen width instead; the client can still pinch to zoom.
 */
const FIT_SCRIPT = `
(function () {
  var root = document.querySelector('.sow-root');
  var sheet = document.querySelector('.sow-root .sow-sheet');
  if (!root || !sheet) return;
  var natural = sheet.offsetWidth;
  function fit() {
    var avail = document.documentElement.clientWidth;
    root.style.zoom = natural > avail ? String(avail / natural) : '';
  }
  fit();
  window.addEventListener('resize', fit);
  // Several quotes: on a narrow screen the strip scrolls sideways, so bring the quote in view into it.
  var strip = document.getElementById('sg-quotes');
  var here = strip && strip.querySelector('.sg-here');
  if (here) strip.scrollLeft = Math.max(0, here.offsetLeft - 12);
})();
`

// String.raw keeps backslashes as written. The script below must not contain
// backticks or a dollar-brace, since it sits inside this template.
const SHELL_SCRIPT = String.raw`
(function () {
  var cfg = JSON.parse(document.getElementById('sg-config').textContent);
  var api = '/api/sign/' + cfg.token;
  // The document is shown first. Signing starts when they ask for it: their
  // details come first, then they agree to sign electronically, then they sign.
  // details is what the server last checked and tidied; it is cleared again if
  // they change anything on the form, so what is sent is what they can see.
  var state = {
    signature: null, method: null, busy: false, finished: false,
    agreed: !!cfg.consented, signing: false, pending: null, details: null
  };

  function $(id) { return document.getElementById(id); }
  function slot(name) { return document.querySelector('.sign-block [data-sign-slot="' + name + '"]'); }
  function post(body) {
    return fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var problem = new Error((data && data.error) || 'Something went wrong. Please try again.');
          problem.field = data && data.field;
          throw problem;
        }
        return data;
      });
    });
  }
  function show(id) { $(id).classList.add('sg-on'); }
  function hide(id) { $(id).classList.remove('sg-on'); }
  var toastTimer = null;
  function toast(message) {
    var el = $('sg-toast');
    el.textContent = message;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.display = 'none'; }, 6000);
  }

  var block = document.getElementById('sign-block');
  var sigSlot = slot('signature');
  var nameSlot = slot('name');
  var dateSlot = slot('date');
  if (!block || !sigSlot || !nameSlot || !dateSlot) {
    toast('This document cannot be signed online. Please contact ' + cfg.brandLabel + '.');
    return;
  }

  // ── Several quotes on one link ────────────────────────────────────────────
  // Each quote is its own page (?doc=2). What they choose for each is kept in
  // this tab until they sign, and goes to the server with the signature. The
  // server works out the totals (action 'review'), so there are no sums here.
  // With one quote on the link none of this applies: signing accepts it.
  var tok = String(cfg.token).slice(0, 16);
  var multi = cfg.quotes.length > 1;
  var here = cfg.current - 1;
  var choicesKey = 'sg-choices:' + tok;
  var stageKey = 'sg-stage:' + tok;
  var decisions = [];
  function keep(key, value) {
    try {
      if (value == null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    } catch (e) {}
  }
  function kept(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  (function () {
    var saved = [];
    try { saved = JSON.parse(kept(choicesKey) || '[]'); } catch (e) {}
    for (var i = 0; i < cfg.quotes.length; i++) {
      var v = saved && saved[i];
      decisions.push(v === 'accepted' || v === 'declined' ? v : null);
    }
  })();
  function mine() { return decisions[here]; }
  /** The number (from 1) of the first quote with this choice; 0 when there is none. */
  function firstWhere(value) {
    for (var i = 0; i < decisions.length; i++) { if (decisions[i] === value) return i + 1; }
    return 0;
  }
  function goTo(n, stage) {
    keep(stageKey, stage || null);
    window.location.search = '?doc=' + n;
  }
  function acceptedLine() {
    var names = [];
    for (var i = 0; i < decisions.length; i++) { if (decisions[i] === 'accepted') names.push(cfg.quotes[i].label); }
    if (names.length < 2) return names[0] || '';
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }
  function renderQuotes() {
    var links = document.querySelectorAll('#sg-quotes [data-n]');
    for (var i = 0; i < links.length; i++) {
      var d = decisions[Number(links[i].getAttribute('data-n')) - 1];
      var el = links[i].querySelector('.sg-q-state');
      el.textContent = d === 'accepted' ? 'Accepted' : (d === 'declined' ? 'Declined' : 'To decide');
      el.className = 'sg-q-state' + (d === 'accepted' ? ' sg-yes' : (d === 'declined' ? ' sg-no' : ''));
    }
  }
  // reviewed: they have confirmed their choices and this quote is one they
  // accepted, so it can be signed. A stage of 'go' means they were just sent
  // here from the review to sign.
  var stage = multi ? kept(stageKey) : null;
  state.reviewed = !multi || (!!stage && !firstWhere(null) && mine() === 'accepted');
  var autostart = multi && state.reviewed && stage === 'go';
  if (autostart) keep(stageKey, 'sign');

  // ── Steps: View, Your details, Sign, Pay deposit ──────────────────────────
  var STEP_ORDER = ['view', 'details', 'sign', 'pay'];
  function setStep(name) {
    var at = STEP_ORDER.indexOf(name);
    var items = document.querySelectorAll('#sg-steps li');
    for (var i = 0; i < items.length; i++) {
      var idx = STEP_ORDER.indexOf(items[i].getAttribute('data-step'));
      items[i].className = idx < at ? 'sg-done' : (idx === at ? 'sg-now' : '');
      items[i].querySelector('b').textContent = idx < at ? '\u2713' : String(i + 1);
    }
  }
  /** The step they are on when no window is open over the document. */
  function restStep() { setStep(state.finished ? 'pay' : (state.details ? 'sign' : 'view')); }

  /**
   * Move from viewing to signing. Their details come first, then agreeing to
   * sign electronically; each is asked once, and only when it is missing.
   */
  function startSigning(then) {
    if (state.busy || state.finished) return;
    // Several quotes: each needs a choice, and the choices a review, first.
    if (multi && !state.reviewed) {
      if (!mine()) toast('Choose Accept quote or Decline at the top of the page first.');
      else if (firstWhere(null)) goTo(firstWhere(null));
      else openReview();
      return;
    }
    if (!state.details) {
      openDetails(then);
      return;
    }
    if (!state.agreed) {
      state.pending = then;
      if (multi) $('sg-consent-doc').textContent = acceptedLine();
      show('sg-consent');
      return;
    }
    if (!state.signing) {
      state.signing = true;
      block.classList.add('sg-live');
    }
    restStep();
    refresh();
    then();
  }

  // ── Fields in the document ────────────────────────────────────────────────
  dateSlot.textContent = cfg.dateLabel;

  // The name in the document is the legal name from their details. It is not
  // typed here: choosing it opens their details.
  var nameText = document.createElement('span');
  nameSlot.classList.add('sg-name-slot');
  nameSlot.appendChild(nameText);
  nameSlot.setAttribute('role', 'button');
  nameSlot.setAttribute('tabindex', '0');
  nameSlot.setAttribute('aria-label', 'Your name, from your details. Choose to change your details.');
  nameSlot.addEventListener('click', function () { if (!state.busy && !state.finished) openDetails(null); });
  nameSlot.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!state.busy && !state.finished) openDetails(null);
    }
  });

  sigSlot.setAttribute('role', 'button');
  sigSlot.setAttribute('tabindex', '0');
  sigSlot.setAttribute('aria-label', 'Sign here');
  sigSlot.addEventListener('click', function () { startSigning(openPad); });
  sigSlot.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); startSigning(openPad); }
  });

  function nameValue() { return state.details ? state.details.legalName : ''; }

  function renderSignature() {
    sigSlot.textContent = '';
    if (state.signature) {
      var img = document.createElement('img');
      img.src = state.signature;
      img.alt = 'Your signature';
      sigSlot.appendChild(img);
      sigSlot.classList.remove('sg-todo');
      sigSlot.classList.add('sg-done');
      sigSlot.setAttribute('aria-label', 'Change signature');
    } else if (multi && !state.reviewed) {
      // Not a quote to sign yet (or one they declined): the field stays plain.
      sigSlot.classList.remove('sg-todo');
      sigSlot.classList.remove('sg-done');
    } else {
      var tag = document.createElement('span');
      tag.className = 'sg-tag';
      tag.textContent = 'Sign here';
      sigSlot.appendChild(tag);
      sigSlot.classList.add('sg-todo');
      sigSlot.classList.remove('sg-done');
    }
  }

  function refresh() {
    nameText.textContent = nameValue();
    var next = $('sg-next');
    next.disabled = state.busy;
    if (multi && !state.reviewed) {
      // Still choosing: Accept or Decline this quote, then on to the next, then the review.
      $('sg-progress').textContent = mine() === 'accepted' ? 'Accepted' : (mine() === 'declined' ? 'Declined' : '');
      next.textContent = !mine() ? 'Accept quote' : (firstWhere(null) ? 'Next quote' : 'Review and sign');
      $('sg-decline-open').textContent = !mine() ? 'Decline' : 'Change';
      return;
    }
    if (multi) $('sg-decline-open').textContent = 'My choices';
    var ready = !!state.details && state.signing;
    $('sg-progress').textContent = !ready ? '' : (state.signature ? 'Ready to finish' : 'Signature needed');
    next.textContent = !state.details ? 'Next: your details' : (!state.signing ? 'Next: sign' : (state.signature ? 'Finish' : 'Next'));
  }

  /** Leave signing and go back to choosing (several quotes only). */
  function stopSigning() {
    state.reviewed = !multi;
    state.signing = false;
    block.classList.remove('sg-live');
  }
  function choose(decision) {
    decisions[here] = decision;
    keep(choicesKey, JSON.stringify(decisions));
    keep(stageKey, null);
    stopSigning();
    renderQuotes();
    renderSignature();
    refresh();
    if (!decision) return;
    var next = firstWhere(null);
    if (next) goTo(next);
    else openReview();
  }

  // ── Review: what they chose, the total, then sign or decline them all ─────
  var noneAccepted = false;
  function openReview() {
    var list = $('sg-review-list');
    var go = $('sg-review-go');
    list.textContent = '';
    $('sg-review-total').textContent = '';
    $('sg-review-sum').textContent = 'Checking your choices…';
    $('sg-review-error').textContent = '';
    $('sg-review-reason').style.display = 'none';
    go.disabled = true;
    show('sg-review');
    post({ action: 'review', decisions: decisions })
      .then(function (data) {
        var s = data.summary;
        for (var i = 0; i < s.items.length; i++) {
          var item = s.items[i];
          var row = document.createElement('div');
          row.className = 'sg-choice';
          var name = document.createElement('div');
          name.className = 'sg-choice-name';
          name.textContent = item.label;
          if (item.totalLabel) {
            var price = document.createElement('small');
            price.textContent = item.totalLabel + ' including GST';
            name.appendChild(price);
          }
          var what = document.createElement('div');
          what.className = item.decision === 'accepted' ? 'sg-yes' : 'sg-no';
          what.textContent = item.decision === 'accepted' ? 'Accepted' : 'Declined';
          row.appendChild(name);
          row.appendChild(what);
          list.appendChild(row);
        }
        noneAccepted = !firstWhere('accepted');
        if (noneAccepted) {
          $('sg-review-sum').textContent = 'You have declined every quote. ' + cfg.brandLabel + ' will be told, and you will not be able to sign from this link afterwards.';
          $('sg-review-reason').style.display = '';
          go.textContent = 'Decline all';
          go.style.background = '#b91c1c';
        } else {
          if (s.acceptedTotalLabel) $('sg-review-total').textContent = 'Total accepted: ' + s.acceptedTotalLabel + ' including GST';
          $('sg-review-sum').textContent =
            (s.depositLabel ? 'Deposit after signing: ' + s.depositLabel + ' (' + s.percentLabel + '). ' : '') +
            'You sign once, and your signature is placed on each quote you accepted.';
          go.textContent = 'Continue to sign';
          go.style.background = '';
        }
        go.disabled = false;
      })
      .catch(function (err) {
        $('sg-review-sum').textContent = '';
        $('sg-review-error').textContent = err && err.message ? err.message : 'Could not check your choices. Please try again.';
      });
  }
  $('sg-review-back').addEventListener('click', function () {
    hide('sg-review');
    if (multi && state.reviewed) {
      keep(stageKey, null);
      stopSigning();
      renderSignature();
      refresh();
    }
  });
  $('sg-review-go').addEventListener('click', function () {
    var go = $('sg-review-go');
    if (noneAccepted) {
      go.disabled = true;
      post({ action: 'decline', reason: $('sg-review-reason').value })
        .then(function () { hide('sg-review'); declinedDone(); })
        .catch(function (err) {
          go.disabled = false;
          $('sg-review-error').textContent = err && err.message ? err.message : 'Could not send that. Please try again.';
        });
      return;
    }
    hide('sg-review');
    // Signing happens in a quote they accepted.
    if (mine() !== 'accepted') { goTo(firstWhere('accepted'), 'go'); return; }
    keep(stageKey, 'sign');
    state.reviewed = true;
    renderSignature();
    refresh();
    startSigning(goToNextField);
  });

  function goToNextField() {
    sigSlot.scrollIntoView({ behavior: 'smooth', block: 'center' });
    sigSlot.focus({ preventScroll: true });
    refresh();
  }

  $('sg-next').addEventListener('click', function () {
    if (state.busy) return;
    if (multi && !state.reviewed) {
      if (!mine()) choose('accepted');
      else if (firstWhere(null)) goTo(firstWhere(null));
      else openReview();
      return;
    }
    if (!state.details || !state.signing) startSigning(goToNextField);
    else if (state.signature) finish();
    else goToNextField();
  });

  // ── Your details (asked when they choose to sign, not on entry) ───────────
  var detailsForm = $('sg-details-form');
  var FIELDS = {
    capacity: 'sg-d-capacity', legalName: 'sg-d-name', dateOfBirth: 'sg-d-dob',
    street: 'sg-d-street', suburb: 'sg-d-suburb', state: 'sg-d-state', postcode: 'sg-d-postcode',
    mobile: 'sg-d-mobile', email: 'sg-d-email',
    companyName: 'sg-d-company-name', companyNumber: 'sg-d-company-number', position: 'sg-d-position',
    declaration: 'sg-d-declare'
  };
  // Typed details survive a reload of this tab, and are forgotten once signed.
  var storeKey = 'sg-details:' + String(cfg.token).slice(0, 16);
  function val(key) { return $(FIELDS[key]).value; }
  function typedDetails() {
    return {
      capacity: val('capacity'), legalName: val('legalName'), dateOfBirth: val('dateOfBirth'),
      address: { street: val('street'), suburb: val('suburb'), state: val('state'), postcode: val('postcode') },
      mobile: val('mobile'), email: val('email'),
      company: { name: val('companyName'), number: val('companyNumber'), position: val('position') }
    };
  }
  function put(key, value) { if (typeof value === 'string') $(FIELDS[key]).value = value; }
  function dayFirst(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : value;
  }
  function fillDetails(d) {
    if (!d || typeof d !== 'object') return;
    var a = d.address || {};
    var c = d.company || {};
    put('capacity', d.capacity); put('legalName', d.legalName); put('dateOfBirth', dayFirst(d.dateOfBirth));
    put('street', a.street); put('suburb', a.suburb); put('state', a.state); put('postcode', a.postcode);
    put('mobile', d.mobile); put('email', d.email);
    put('companyName', c.name); put('companyNumber', c.number); put('position', c.position);
    showCompany();
  }
  function showCompany() {
    var rule = cfg.companyRules[val('capacity')] || 'none';
    $('sg-d-company').style.display = rule === 'none' ? 'none' : '';
    $('sg-d-company-note').textContent = rule === 'optional'
      ? 'If you act for a company (for example a real estate agency), add it here. Leave these empty if not.'
      : 'The company you are signing for.';
  }
  function remember() {
    try { sessionStorage.setItem(storeKey, JSON.stringify(typedDetails())); } catch (e) {}
  }
  function clearBad() {
    var bad = detailsForm.querySelectorAll('.sg-bad');
    for (var i = 0; i < bad.length; i++) { bad[i].classList.remove('sg-bad'); bad[i].removeAttribute('aria-invalid'); }
    $('sg-details-error').textContent = '';
  }
  function detailsProblem(field, message) {
    $('sg-details-error').textContent = message;
    var el = field && FIELDS[field] ? $(FIELDS[field]) : null;
    if (!el) return;
    if (el.type !== 'checkbox') { el.classList.add('sg-bad'); el.setAttribute('aria-invalid', 'true'); }
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
  }
  function openDetails(then) {
    state.pending = then || state.pending;
    clearBad();
    show('sg-details');
    setStep('details');
  }
  function closeDetails() {
    hide('sg-details');
    restStep();
  }
  try {
    var kept = sessionStorage.getItem(storeKey);
    if (kept) fillDetails(JSON.parse(kept));
  } catch (e) {}
  showCompany();
  $(FIELDS.capacity).addEventListener('change', showCompany);
  // Anything changed after the check means it must be checked again.
  function changed() {
    if (state.details) { state.details = null; $(FIELDS.declaration).checked = false; refresh(); }
    remember();
  }
  detailsForm.addEventListener('input', function (event) { if (event.target !== $(FIELDS.declaration)) changed(); });
  detailsForm.addEventListener('change', function (event) { if (event.target !== $(FIELDS.declaration)) changed(); });
  $('sg-details-back').addEventListener('click', function () { state.pending = null; closeDetails(); });
  detailsForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (state.busy || state.finished) return;
    clearBad();
    var button = $('sg-details-continue');
    button.disabled = true;
    remember();
    post({ action: 'details', details: typedDetails(), declared: $(FIELDS.declaration).checked })
      .then(function (data) {
        state.details = data.details;
        fillDetails(data.details);
        remember();
        closeDetails();
        var then = state.pending || goToNextField;
        state.pending = null;
        startSigning(then);
      })
      .catch(function (err) {
        detailsProblem(err && err.field, err && err.message ? err.message : 'Could not check your details. Please try again.');
      })
      .then(function () { button.disabled = false; });
  });

  // ── Agree to sign electronically ──────────────────────────────────────────
  var agree = $('sg-agree');
  var agreeBtn = $('sg-agree-continue');
  agree.addEventListener('change', function () { agreeBtn.disabled = !agree.checked; });
  agreeBtn.addEventListener('click', function () {
    if (!agree.checked) return;
    state.agreed = true;
    hide('sg-consent');
    post({ action: 'consent' }).catch(function () {});
    var then = state.pending || goToNextField;
    state.pending = null;
    startSigning(then);
  });
  $('sg-agree-cancel').addEventListener('click', function () {
    state.pending = null;
    hide('sg-consent');
  });
  post({ action: 'view' }).catch(function () {});

  // ── Signature window: draw or type ────────────────────────────────────────
  var canvas = $('sg-canvas');
  var ctx = canvas.getContext('2d');
  var ink = null;      // bounds of what has been drawn, in canvas pixels
  var drawing = false;
  var last = null;
  var mode = 'draw';
  var typed = $('sg-typed-input');
  var typedPreview = $('sg-typed-preview');
  var SCRIPT_FONT = "'Snell Roundhand', 'Brush Script MT', 'Segoe Script', 'Lucida Handwriting', 'Apple Chancery', cursive";

  function sizeCanvas() {
    var rect = canvas.getBoundingClientRect();
    var ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.lineWidth = 2.4 * ratio;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0b1f44';
    ink = null;
    $('sg-pad-hint').style.display = '';
  }
  function point(event) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
  }
  function grow(p) {
    if (!ink) ink = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    ink.x1 = Math.min(ink.x1, p.x); ink.y1 = Math.min(ink.y1, p.y);
    ink.x2 = Math.max(ink.x2, p.x); ink.y2 = Math.max(ink.y2, p.y);
  }
  canvas.addEventListener('pointerdown', function (event) {
    event.preventDefault();
    drawing = true;
    last = point(event);
    grow(last);
    try { canvas.setPointerCapture(event.pointerId); } catch (e) {}
    ctx.beginPath();
    ctx.arc(last.x, last.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    $('sg-pad-hint').style.display = 'none';
    updateAdopt();
  });
  canvas.addEventListener('pointermove', function (event) {
    if (!drawing) return;
    event.preventDefault();
    var p = point(event);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
    grow(p);
  });
  function stop() { drawing = false; updateAdopt(); }
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  // Enough ink to be a signature rather than a stray tap.
  function drawnOk() { return !!ink && (ink.x2 - ink.x1) + (ink.y2 - ink.y1) > 40; }
  function typedOk() { return typed.value.replace(/\s+/g, ' ').trim().length >= 2; }
  function updateAdopt() { $('sg-adopt').disabled = mode === 'draw' ? !drawnOk() : !typedOk(); }

  function setMode(next) {
    mode = next;
    $('sg-tab-draw').classList.toggle('sg-on', mode === 'draw');
    $('sg-tab-type').classList.toggle('sg-on', mode === 'type');
    $('sg-draw-pane').style.display = mode === 'draw' ? '' : 'none';
    $('sg-type-pane').style.display = mode === 'type' ? '' : 'none';
    if (mode === 'draw') sizeCanvas();
    else { typedPreview.textContent = typed.value; typed.focus(); }
    updateAdopt();
  }
  $('sg-tab-draw').addEventListener('click', function () { setMode('draw'); });
  $('sg-tab-type').addEventListener('click', function () { setMode('type'); });
  $('sg-clear').addEventListener('click', function () {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ink = null;
    $('sg-pad-hint').style.display = '';
    updateAdopt();
  });
  typed.addEventListener('input', function () { typedPreview.textContent = typed.value; updateAdopt(); });

  function openPad() {
    if (state.busy || state.finished) return;
    if (!typed.value) typed.value = nameValue();
    show('sg-pad');
    setMode(mode);
  }
  $('sg-pad-cancel').addEventListener('click', function () { hide('sg-pad'); });

  /** Copy the inked area to a tidy PNG no bigger than 800 x 300. */
  function exportDrawn() {
    var pad = 10 * (canvas.width / canvas.getBoundingClientRect().width);
    var x = Math.max(0, Math.floor(ink.x1 - pad));
    var y = Math.max(0, Math.floor(ink.y1 - pad));
    var w = Math.min(canvas.width - x, Math.ceil(ink.x2 - ink.x1 + pad * 2));
    var h = Math.min(canvas.height - y, Math.ceil(ink.y2 - ink.y1 + pad * 2));
    var scale = Math.min(1, 800 / w, 300 / h);
    var out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(w * scale));
    out.height = Math.max(1, Math.round(h * scale));
    out.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }
  function exportTyped() {
    var text = typed.value.replace(/\s+/g, ' ').trim();
    var out = document.createElement('canvas');
    var c = out.getContext('2d');
    var size = 96;
    c.font = 'italic ' + size + 'px ' + SCRIPT_FONT;
    var width = c.measureText(text).width;
    if (width > 760) { size = Math.max(28, Math.floor(size * 760 / width)); }
    c.font = 'italic ' + size + 'px ' + SCRIPT_FONT;
    width = c.measureText(text).width;
    out.width = Math.ceil(width + 40);
    out.height = Math.ceil(size * 1.7);
    c = out.getContext('2d');
    c.font = 'italic ' + size + 'px ' + SCRIPT_FONT;
    c.fillStyle = '#0b1f44';
    c.textBaseline = 'middle';
    c.fillText(text, 20, out.height / 2);
    return out.toDataURL('image/png');
  }
  $('sg-adopt').addEventListener('click', function () {
    if (mode === 'draw' ? !drawnOk() : !typedOk()) return;
    state.signature = mode === 'draw' ? exportDrawn() : exportTyped();
    state.method = mode === 'draw' ? 'drawn' : 'typed';
    hide('sg-pad');
    renderSignature();
    refresh();
  });

  // ── Finish ────────────────────────────────────────────────────────────────
  function finish() {
    if (!state.details || !state.signature) return;
    state.busy = true;
    $('sg-next').textContent = 'Signing…';
    $('sg-next').disabled = true;
    var signing = { action: 'sign', details: state.details, declared: true, signature: state.signature, method: state.method, agreed: true };
    // Several quotes: what was chosen for each goes with the signature.
    if (multi) signing.decisions = decisions;
    post(signing)
      .then(function (data) {
        state.finished = true;
        try { sessionStorage.removeItem(storeKey); } catch (e) {}
        keep(choicesKey, null);
        keep(stageKey, null);
        nameSlot.textContent = nameValue();
        nameSlot.classList.remove('sg-name-slot');
        nameSlot.removeAttribute('role');
        nameSlot.removeAttribute('tabindex');
        nameSlot.removeAttribute('aria-label');
        if (data && data.dateLabel) dateSlot.textContent = data.dateLabel;
        // The server says what was signed and where the copy is going, and the
        // deposit on what was accepted.
        if (data && data.copyLine) $('sg-done-copy').textContent = data.copyLine;
        var depositNote = $('sg-done-deposit');
        if (depositNote && data && 'deposit' in data) {
          if (data.deposit) {
            $('sg-done-amount').textContent = data.deposit.amountLabel;
            $('sg-done-percent').textContent = data.deposit.percentLabel;
          } else {
            depositNote.style.display = 'none';
          }
        }
        block.classList.remove('sg-live');
        sigSlot.removeAttribute('role');
        sigSlot.removeAttribute('tabindex');
        sigSlot.classList.remove('sg-done');
        $('sg-progress').textContent = 'Signed';
        $('sg-next').style.display = 'none';
        $('sg-decline-open').style.display = 'none';
        setStep('pay');
        show('sg-done');
      })
      .catch(function (err) {
        state.busy = false;
        // The server found a problem with their details: back to that step.
        if (err && err.field) {
          state.details = null;
          refresh();
          openDetails(null);
          detailsProblem(err.field, err.message);
          return;
        }
        refresh();
        toast(err && err.message ? err.message : 'Could not record your signature. Please try again.');
      });
  }

  // ── Decline ───────────────────────────────────────────────────────────────
  function declinedDone() {
    state.finished = true;
    keep(choicesKey, null);
    keep(stageKey, null);
    $('sg-next').style.display = 'none';
    $('sg-decline-open').style.display = 'none';
    $('sg-progress').textContent = 'Declined';
    block.classList.remove('sg-live');
    show('sg-declined');
  }
  $('sg-decline-open').addEventListener('click', function () {
    if (state.busy || state.finished) return;
    // Several quotes: this button declines the quote in view (or undoes the
    // choice). Declining them all is offered on the review.
    if (multi) {
      if (state.reviewed) openReview();
      else choose(mine() ? null : 'declined');
      return;
    }
    $('sg-decline-error').textContent = '';
    show('sg-decline');
  });
  $('sg-decline-cancel').addEventListener('click', function () { hide('sg-decline'); });
  $('sg-decline-confirm').addEventListener('click', function () {
    var button = $('sg-decline-confirm');
    button.disabled = true;
    post({ action: 'decline', reason: $('sg-decline-reason').value })
      .then(function () {
        hide('sg-decline');
        declinedDone();
      })
      .catch(function (err) {
        button.disabled = false;
        $('sg-decline-error').textContent = err && err.message ? err.message : 'Could not send that. Please try again.';
      });
  });

  // After signing, the same link shows the signed document and the pay step.
  var onward = $('sg-done-next');
  if (onward) onward.addEventListener('click', function () { window.location.reload(); });

  renderQuotes();
  renderSignature();
  refresh();
  if (autostart) startSigning(goToNextField);
})();
`

/** A quote on the link, as the page names it. */
export interface ShellQuote {
  /** Its number on the link, from 1. */
  n: number
  /** e.g. "Trauma Cleaning Q-1042". */
  label: string
}

export interface SigningShellData {
  token: string
  brandLabel: string
  /** The quote this page shows. */
  documentTitle: string
  reference: string | null
  /** Every quote on the link, in order. One entry when the link has a single quote. */
  quotes: ShellQuote[]
  /** The number of the quote this page shows, from 1. */
  current: number
  toName: string
  /** Null when the link was sent by text and no email was given. */
  toEmail: string | null
  /** Where this client downloads the signed copy (differs by host). */
  pdfUrl: string
  /** Today's date as it will be written in the Date field. The server sets the real one. */
  dateLabel: string
  consented: boolean
  /**
   * The deposit asked for after signing, e.g. "$1,650.00" and "50%". Null when
   * there is no pay step. With several quotes this is the deposit if all are
   * accepted; the page is told the real one when they sign.
   */
  deposit: { amountLabel: string; percentLabel: string } | null
}

type Step = 'view' | 'details' | 'sign' | 'pay'

/** The steps under the bar. `current` past the last step shows them all as done. */
function stepsHtml(current: Step | 'finished', hasPay: boolean, several = false): string {
  const steps: { id: Step; label: string }[] = [
    { id: 'view', label: several ? 'Choose' : 'View' },
    { id: 'details', label: 'Your details' },
    { id: 'sign', label: 'Sign' },
    ...(hasPay ? [{ id: 'pay' as const, label: 'Pay deposit' }] : []),
  ]
  const order: (Step | 'finished')[] = ['view', 'details', 'sign', 'pay', 'finished']
  const at = order.indexOf(current)
  return `<ol id="sg-steps" aria-label="Steps">${steps
    .map((step, i) => {
      const idx = order.indexOf(step.id)
      const cls = idx < at ? 'sg-done' : idx === at ? 'sg-now' : ''
      return `<li data-step="${step.id}"${cls ? ` class="${cls}"` : ''}${idx === at ? ' aria-current="step"' : ''}><b>${idx < at ? '✓' : i + 1}</b>${step.label}</li>`
    })
    .join('')}</ol>`
}

/**
 * Everything added to the document page while it is waiting to be signed. The
 * document is in view from the first moment; nothing here covers it until the
 * client chooses to sign.
 */
export function signingShellHtml(d: SigningShellData): string {
  const docLine = `${d.documentTitle}${d.reference ? ` ${d.reference}` : ''}`
  const pdfUrl = d.pdfUrl
  const who = `${d.toName}${d.toEmail ? ` (${d.toEmail})` : ''}`
  // Several quotes on the link: each is accepted or declined, then one signature.
  const several = d.quotes.length > 1
  return `
  <div id="sg-root">
    <style>${SHELL_CSS}${several ? SEVERAL_CSS : ''}</style>
    <div id="sg-bar">
      <div class="sg-doc">
        <div class="sg-brand">${several ? `Quote ${d.current} of ${d.quotes.length} · ` : ''}${esc(d.brandLabel)}</div>
        <div class="sg-title">${esc(docLine)}</div>
      </div>
      <span class="sg-progress" id="sg-progress" aria-live="polite"></span>
      <button type="button" class="sg-btn sg-btn-quiet" id="sg-decline-open">Decline</button>
      <button type="button" class="sg-btn" id="sg-next">${several ? 'Accept quote' : 'Next: your details'}</button>
    </div>
    ${stepsHtml('view', Boolean(d.deposit), several)}
    ${several ? `<nav id="sg-quotes" aria-label="Quotes on this link">${d.quotes
      .map(q => `<a class="sg-q${q.n === d.current ? ' sg-here' : ''}" href="?doc=${q.n}" data-n="${q.n}"${q.n === d.current ? ' aria-current="page"' : ''}><b>${q.n}</b>${esc(q.label)}<span class="sg-q-state">To decide</span></a>`)
      .join('')}</nav>` : ''}

    <div class="sg-overlay" id="sg-review" role="dialog" aria-modal="true" aria-labelledby="sg-review-h">
      <div class="sg-card">
        <div class="sg-eyebrow">${esc(d.brandLabel)}</div>
        <h2 id="sg-review-h">Your choices</h2>
        <div class="sg-choices" id="sg-review-list"></div>
        <div class="sg-total" id="sg-review-total"></div>
        <p id="sg-review-sum" aria-live="polite"></p>
        <textarea class="sg-input" id="sg-review-reason" maxlength="1000" placeholder="Reason (optional)" aria-label="Reason (optional)" style="display:none"></textarea>
        <div class="sg-error" id="sg-review-error" role="alert"></div>
        <div class="sg-actions">
          <button type="button" class="sg-btn sg-btn-quiet" id="sg-review-back">Back to the quotes</button>
          <button type="button" class="sg-btn" id="sg-review-go" disabled>Continue to sign</button>
        </div>
      </div>
    </div>

    <div class="sg-overlay" id="sg-details" role="dialog" aria-modal="true" aria-labelledby="sg-details-h">
      <form class="sg-card sg-card-wide" id="sg-details-form" novalidate>
        <div class="sg-eyebrow">${esc(d.brandLabel)}</div>
        <h2 id="sg-details-h">Your details</h2>
        <p>Before you sign, tell us who is accepting ${several ? 'the quotes you chose' : esc(docLine)}. ${esc(d.brandLabel)} uses these details for your invoice and to contact you.</p>

        <label class="sg-label" for="sg-d-capacity">I am signing as</label>
        <select class="sg-input" id="sg-d-capacity">
          <option value="">Choose one</option>
          ${CAPACITIES.map(c => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}
        </select>

        <label class="sg-label" for="sg-d-name">Full legal name</label>
        <input type="text" class="sg-input" id="sg-d-name" maxlength="120" autocomplete="name" value="${esc(d.toName)}">

        <label class="sg-label" for="sg-d-dob">Date of birth <small>day / month / year</small></label>
        <input type="text" class="sg-input" id="sg-d-dob" maxlength="10" inputmode="numeric" autocomplete="bday" placeholder="DD/MM/YYYY">

        <div class="sg-group">
          <label class="sg-label" for="sg-d-street">Residential address <small>where you live, not a PO box</small></label>
          <input type="text" class="sg-input" id="sg-d-street" maxlength="120" autocomplete="address-line1" placeholder="Street address">
          <div class="sg-row">
            <div class="sg-first">
              <label class="sg-label" for="sg-d-suburb">Suburb or town</label>
              <input type="text" class="sg-input" id="sg-d-suburb" maxlength="60" autocomplete="address-level2">
            </div>
            <div class="sg-narrow">
              <label class="sg-label" for="sg-d-state">State</label>
              <select class="sg-input" id="sg-d-state" autocomplete="address-level1">
                <option value=""></option>
                ${STATES.map(s => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>
            <div class="sg-narrow">
              <label class="sg-label" for="sg-d-postcode">Postcode</label>
              <input type="text" class="sg-input" id="sg-d-postcode" maxlength="4" inputmode="numeric" autocomplete="postal-code">
            </div>
          </div>
        </div>

        <div class="sg-group">
          <div class="sg-row">
            <div class="sg-first">
              <label class="sg-label" for="sg-d-mobile">Mobile</label>
              <input type="tel" class="sg-input" id="sg-d-mobile" maxlength="20" autocomplete="tel" placeholder="0412 345 678">
            </div>
            <div class="sg-first">
              <label class="sg-label" for="sg-d-email">Email</label>
              <input type="email" class="sg-input" id="sg-d-email" maxlength="160" autocomplete="email" value="${esc(d.toEmail ?? '')}">
            </div>
          </div>
        </div>

        <div class="sg-group" id="sg-d-company" style="display:none">
          <p class="sg-small" id="sg-d-company-note" style="margin:0 0 10px"></p>
          <label class="sg-label" for="sg-d-company-name">Company name</label>
          <input type="text" class="sg-input" id="sg-d-company-name" maxlength="120" autocomplete="organization">
          <div class="sg-row">
            <div class="sg-first">
              <label class="sg-label" for="sg-d-company-number">ABN or ACN</label>
              <input type="text" class="sg-input" id="sg-d-company-number" maxlength="20" inputmode="numeric" autocomplete="off">
            </div>
            <div class="sg-first">
              <label class="sg-label" for="sg-d-position">Your position</label>
              <input type="text" class="sg-input" id="sg-d-position" maxlength="120" autocomplete="organization-title" placeholder="For example Director">
            </div>
          </div>
        </div>

        <div class="sg-declare">
          <label class="sg-check">
            <input type="checkbox" id="sg-d-declare">
            <span>${esc(declarationText(d.brandLabel))}</span>
          </label>
        </div>
        <div class="sg-error" id="sg-details-error" role="alert"></div>
        <div class="sg-actions" style="margin-top:10px">
          <button type="button" class="sg-btn sg-btn-quiet" id="sg-details-back">Back to document</button>
          <button type="submit" class="sg-btn" id="sg-details-continue">Continue</button>
        </div>
      </form>
    </div>

    <div class="sg-overlay" id="sg-consent" role="dialog" aria-modal="true" aria-labelledby="sg-consent-h">
      <div class="sg-card">
        <div class="sg-eyebrow">${esc(d.brandLabel)}</div>
        <h2 id="sg-consent-h">${several ? 'Sign what you accepted' : 'Sign this document'}</h2>
        <div class="sg-facts">
          <div><span>${several ? 'Accepted:' : 'Document:'}</span> <span id="sg-consent-doc" style="color:inherit">${esc(docLine)}</span></div>
          <div><span>For:</span> ${esc(who)}</div>
        </div>
        <p>${several
          ? 'You sign once, at the end of this quote, under the name you gave in your details. Your signature, name and the date are placed on each quote you accepted. It takes about a minute, and your signed copies are emailed to you straight away.'
          : 'You sign at the end of the document, under the name you gave in your details. It takes about a minute, and a signed copy is emailed to you straight away.'}</p>
        <label class="sg-check">
          <input type="checkbox" id="sg-agree">
          <span>I agree to sign ${several ? 'these documents' : 'this document'} electronically, and that my electronic signature has the same effect as signing on paper.</span>
        </label>
        <div class="sg-actions">
          <button type="button" class="sg-btn sg-btn-quiet" id="sg-agree-cancel">Not yet</button>
          <button type="button" class="sg-btn" id="sg-agree-continue" disabled>Continue</button>
        </div>
        <p class="sg-small" style="margin:14px 0 0">Not the right person, or prefer paper? Contact ${esc(d.brandLabel)}.</p>
      </div>
    </div>

    <div class="sg-overlay" id="sg-pad" role="dialog" aria-modal="true" aria-labelledby="sg-pad-h">
      <div class="sg-card">
        <h2 id="sg-pad-h">Your signature</h2>
        <div class="sg-tabs">
          <button type="button" class="sg-tab sg-on" id="sg-tab-draw">Draw</button>
          <button type="button" class="sg-tab" id="sg-tab-type">Type</button>
        </div>
        <div id="sg-draw-pane">
          <div class="sg-pad">
            <canvas id="sg-canvas" aria-label="Draw your signature here"></canvas>
            <div class="sg-line"></div>
            <div class="sg-hint" id="sg-pad-hint">Sign with your finger or mouse</div>
          </div>
          <div style="margin-top:8px"><button type="button" class="sg-btn sg-btn-quiet" id="sg-clear" style="padding:6px 12px;font-size:13px">Clear</button></div>
        </div>
        <div id="sg-type-pane" style="display:none">
          <input type="text" class="sg-input" id="sg-typed-input" maxlength="80" placeholder="Type your full name" autocomplete="name" aria-label="Type your full name">
          <div class="sg-typed" id="sg-typed-preview" aria-hidden="true"></div>
        </div>
        <p class="sg-small" style="margin:14px 0 16px">By choosing Adopt and sign, I agree this is my signature on ${several ? 'each quote I accepted' : 'this document'}.</p>
        <div class="sg-actions">
          <button type="button" class="sg-btn sg-btn-quiet" id="sg-pad-cancel">Cancel</button>
          <button type="button" class="sg-btn" id="sg-adopt" disabled>Adopt and sign</button>
        </div>
      </div>
    </div>

    <div class="sg-overlay" id="sg-decline" role="dialog" aria-modal="true" aria-labelledby="sg-decline-h">
      <div class="sg-card">
        <h2 id="sg-decline-h">Decline this document?</h2>
        <p>${esc(d.brandLabel)} will be told you declined. You will not be able to sign from this link afterwards.</p>
        <textarea class="sg-input" id="sg-decline-reason" maxlength="1000" placeholder="Reason (optional)" aria-label="Reason (optional)"></textarea>
        <div class="sg-error" id="sg-decline-error" role="alert"></div>
        <div class="sg-actions">
          <button type="button" class="sg-btn sg-btn-quiet" id="sg-decline-cancel">Go back</button>
          <button type="button" class="sg-btn" id="sg-decline-confirm" style="background:#b91c1c">Decline document</button>
        </div>
      </div>
    </div>

    <div class="sg-overlay" id="sg-done" role="dialog" aria-modal="true" aria-labelledby="sg-done-h">
      <div class="sg-card">
        <div class="sg-eyebrow">${esc(d.brandLabel)}</div>
        <h2 id="sg-done-h">Signed. Thank you.</h2>
        <p><span id="sg-done-copy">${d.toEmail
          ? `Your signed copy of ${esc(docLine)} is being emailed to ${esc(d.toEmail)}.`
          : `Your signed copy of ${esc(docLine)} is ready.`}</span> ${several
          ? 'Each signed quote can be downloaded on the next page; keep them for your records.'
          : 'You can download it now and keep it for your records.'}</p>
        ${d.deposit
          ? `<p id="sg-done-deposit">The next step is your deposit of <strong id="sg-done-amount">${esc(d.deposit.amountLabel)}</strong> (<span id="sg-done-percent" style="color:inherit">${esc(d.deposit.percentLabel)}</span>). There is nothing to pay yet: ${esc(d.brandLabel)} will check the details, prepare your invoice and let you know when it is ready.</p>`
          : ''}
        ${several
          // Which copies there are depends on what was accepted: the signed page lists them.
          ? `<div class="sg-actions">
          <button type="button" class="sg-btn" id="sg-done-next">Continue</button>
        </div>`
          : d.deposit
            ? `<div class="sg-actions">
          <a class="sg-btn sg-btn-quiet" href="${esc(pdfUrl)}">Download signed copy</a>
          <button type="button" class="sg-btn" id="sg-done-next">Continue</button>
        </div>`
            : `<div class="sg-actions">
          <a class="sg-btn" href="${esc(pdfUrl)}">Download signed copy</a>
        </div>
        <p class="sg-small" style="margin:14px 0 0">You can close this page.</p>`}
      </div>
    </div>

    <div class="sg-overlay" id="sg-declined" role="dialog" aria-modal="true" aria-labelledby="sg-declined-h">
      <div class="sg-card">
        <h2 id="sg-declined-h">Document declined</h2>
        <p>${esc(d.brandLabel)} has been told. You can close this page.</p>
      </div>
    </div>

    <div id="sg-toast" role="alert"></div>
    <script type="application/json" id="sg-config">${scriptJson({
      token: d.token,
      dateLabel: d.dateLabel,
      consented: d.consented,
      brandLabel: d.brandLabel,
      docLine,
      // The quotes on the link and which one this page shows.
      quotes: d.quotes,
      current: d.current,
      // Which capacities ask for a company: required, optional or none.
      companyRules: Object.fromEntries(CAPACITIES.map(c => [c.id, companyRule(c.id)])),
    })}</script>
    <script>${FIT_SCRIPT}</script>
    <script>${SHELL_SCRIPT}</script>
  </div>`
}

// ── Pay deposit ──────────────────────────────────────────────────────────────

function bankRow(label: string, value: string): string {
  return `<div class="sg-bank-row"><span>${esc(label)}</span><strong>${esc(value)}</strong><button type="button" class="sg-copy" data-copy="${esc(value)}" aria-label="Copy ${esc(label.toLowerCase())}">Copy</button></div>`
}

/**
 * The inside of the pay card. Built on the server both for the page and for the
 * page's later checks (which swap this in), so there is one version of the
 * wording. Until staff have checked the signed request and the invoice is
 * approved in Xero, it says the invoice is being prepared and shows no way to
 * pay. After that, card and bank transfer are shown together. Nothing is
 * promised that cannot happen: the card button only appears with a real Xero
 * pay link, and the bank block only when bank details are saved.
 */
export function payPanelHtml(p: PayPanel): string {
  const brand = esc(p.brandLabel)
  const share = `${percentLabel(p.percent)} of ${money(p.total)} including GST`

  if (depositSettled(p)) {
    const when = longDate(p.paidOn)
    return `
      <div class="sg-eyebrow">${brand}</div>
      <h2 id="sg-pay-h">Deposit received</h2>
      <div class="sg-good">Thank you. We have received ${esc(money(p.paid))}${when ? ` on ${esc(when)}` : ''}.</div>
      <p class="sg-small">Your deposit was ${esc(money(p.deposit))} (${esc(share)}). ${brand} will be in touch about next steps.</p>`
  }

  // Signed, but not yet checked by staff or approved in Xero: no way to pay is shown.
  if (p.stage === 'preparing') {
    return `
      <div class="sg-eyebrow">${brand}</div>
      <h2 id="sg-pay-h">Your invoice is being prepared</h2>
      <div class="sg-note">Thank you for signing. ${brand} is checking the details and preparing your invoice. We will let you know when it is ready, and the payment details will then be on this page.</div>
      <p class="sg-small">Your deposit is ${esc(money(p.deposit))} (${esc(share)}). There is nothing to pay yet.</p>`
  }

  const part = depositPartPaid(p)
  const ready = p.stage === 'ready'
  const card = ready && p.cardUrl
    ? `<a class="sg-btn sg-btn-wide" href="${esc(p.cardUrl)}" target="_blank" rel="noopener noreferrer">Pay by card</a>
      <p class="sg-small" style="margin:8px 0 0">Opens your invoice${p.invoiceNumber ? ` ${esc(p.invoiceNumber)}` : ''} from ${brand}, where you can pay online.</p>`
    : ''
  const bank = ready && p.bank
    ? `<h3>Pay by bank transfer</h3>
      <div class="sg-bank">
        ${bankRow('Account name', p.bank.accountName)}
        ${bankRow('BSB', p.bank.bsb)}
        ${bankRow('Account number', p.bank.accountNumber)}
        ${bankRow('Reference', p.reference)}
      </div>
      <p class="sg-small">Please include the reference so we can match your payment. A bank transfer can take a day or two to reach us.</p>`
    : ''
  const neither = !card && !bank
    ? `<div class="sg-note">${brand} will be in touch with payment details.</div>`
    : ''

  return `
      <div class="sg-eyebrow">${brand}</div>
      <h2 id="sg-pay-h">Pay your deposit</h2>
      <div class="sg-amount">${esc(money(part ? part.remaining : p.deposit))}</div>
      <p class="sg-small" style="margin:0 0 14px">${part
        ? `Still to pay. We have received ${esc(money(part.received))} of your ${esc(money(p.deposit))} deposit (${esc(share)}).`
        : `${esc(share)}.`}</p>
      ${card}
      ${bank}
      ${neither}`
}

// No backticks or dollar-braces in here either (see SHELL_SCRIPT).
const PAY_SCRIPT = String.raw`
(function () {
  var cfg = JSON.parse(document.getElementById('sg-pay-config').textContent);
  var overlay = document.getElementById('sg-pay');
  var body = document.getElementById('sg-pay-body');
  var open = document.getElementById('sg-pay-open');
  var step = document.querySelector('#sg-steps [data-step="pay"]');
  var settled = !!cfg.settled;
  var busy = false;
  var checks = 0;
  var shown = null;

  open.addEventListener('click', function () { overlay.classList.add('sg-on'); check(); });
  document.getElementById('sg-pay-close').addEventListener('click', function () { overlay.classList.remove('sg-on'); });

  // Copy buttons beside the bank details.
  body.addEventListener('click', function (event) {
    var button = event.target && event.target.closest ? event.target.closest('[data-copy]') : null;
    if (!button || !navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(button.getAttribute('data-copy')).then(function () {
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = 'Copy'; }, 1500);
    }, function () {});
  });

  function label(stage) {
    if (!settled && stage) open.textContent = stage === 'preparing' ? 'Your deposit' : 'Pay deposit';
  }
  function markSettled() {
    open.textContent = 'Deposit received';
    if (step) {
      step.className = 'sg-done';
      step.removeAttribute('aria-current');
      step.querySelector('b').textContent = '\u2713';
    }
  }

  // The payment details appear once staff have checked the signed document and
  // approved the invoice, and the deposit shows as received once it is paid.
  // Ask now and then while the page is in view.
  function check() {
    if (busy || settled || document.hidden) return;
    busy = true;
    fetch('/api/sign/' + cfg.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pay' })
    }).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (data) {
      if (!data || typeof data.html !== 'string') return;
      if (data.html !== shown) { body.innerHTML = data.html; shown = data.html; }
      if (data.settled) { settled = true; markSettled(); }
      else label(data.stage);
    }).catch(function () {}).then(function () { busy = false; });
  }

  var timer = setInterval(function () {
    checks += 1;
    if (settled || checks > 40) { clearInterval(timer); return; }
    check();
  }, 30000);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
})();
`

/**
 * What is added to a document that has been signed from this link: the bar with
 * the download, the steps, and the pay step when the request has a deposit.
 */
export function signedViewHtml(d: {
  token: string
  pdfUrl: string
  brandLabel: string
  documentTitle: string
  reference: string | null
  signerName: string
  signedAtLabel: string
  /** Null when no deposit was asked for. */
  pay: PayPanel | null
  /**
   * Every quote that was on the link, when there was more than one, with what
   * the signer chose. Accepted quotes link to their signed copy; declined ones
   * are named but cannot be opened.
   */
  quotes?: (ShellQuote & { accepted: boolean })[]
  /** The number of the quote this page shows, from 1. */
  current?: number
  /** False when they are moving between their signed quotes: the pay step is not put in front again. */
  payOpen?: boolean
}): string {
  const docLine = `${d.documentTitle}${d.reference ? ` ${d.reference}` : ''}`
  const settled = d.pay ? depositSettled(d.pay) : false
  const quotes = d.quotes && d.quotes.length > 1 ? d.quotes : null
  const payOpen = !settled && d.payOpen !== false
  return `
  <div id="sg-root">
    <style>${SHELL_CSS}${quotes ? SEVERAL_CSS : ''}</style>
    <div id="sg-bar">
      <div class="sg-doc">
        <div class="sg-brand">${quotes ? `Quote ${d.current ?? 1} of ${quotes.length} · Signed · ${esc(d.brandLabel)}` : `${esc(d.brandLabel)} · Signed`}</div>
        <div class="sg-title">${esc(docLine)} — signed by ${esc(d.signerName)}, ${esc(d.signedAtLabel)}</div>
      </div>
      <a class="sg-btn${d.pay ? ' sg-btn-quiet' : ''}" href="${esc(d.pdfUrl)}">Download<span class="sg-wide"> signed copy</span></a>
      ${d.pay ? `<button type="button" class="sg-btn" id="sg-pay-open">${settled ? 'Deposit received' : d.pay.stage === 'preparing' ? 'Your deposit' : 'Pay deposit'}</button>` : ''}
    </div>
    ${stepsHtml(d.pay && !settled ? 'pay' : 'finished', Boolean(d.pay), Boolean(quotes))}
    ${quotes ? `<nav id="sg-quotes" aria-label="Quotes on this link">${quotes
      .map(q => q.accepted
        ? `<a class="sg-q${q.n === d.current ? ' sg-here' : ''}" href="?doc=${q.n}&amp;view=1"${q.n === d.current ? ' aria-current="page"' : ''}><b>${q.n}</b>${esc(q.label)}<span class="sg-q-state sg-yes">Signed</span></a>`
        : `<span class="sg-q sg-off"><b>${q.n}</b>${esc(q.label)}<span class="sg-q-state sg-no">Declined</span></span>`)
      .join('')}</nav>` : ''}
    ${d.pay ? `
    <div class="sg-overlay${payOpen ? ' sg-on' : ''}" id="sg-pay" role="dialog" aria-modal="true" aria-labelledby="sg-pay-h">
      <div class="sg-card">
        <div id="sg-pay-body" aria-live="polite">${payPanelHtml(d.pay)}</div>
        <div class="sg-actions" style="margin-top:18px">
          <a class="sg-btn sg-btn-quiet" href="${esc(d.pdfUrl)}">Download signed copy</a>
          <button type="button" class="sg-btn sg-btn-quiet" id="sg-pay-close">View signed document</button>
        </div>
      </div>
    </div>
    <script type="application/json" id="sg-pay-config">${scriptJson({ token: d.token, settled })}</script>
    <script>${PAY_SCRIPT}</script>` : ''}
    <script>${FIT_SCRIPT}</script>
  </div>`
}

// No backticks or dollar-braces in here either (see SHELL_SCRIPT).
const GATE_SCRIPT = String.raw`
(function () {
  var cfg = JSON.parse(document.getElementById('pg-config').textContent);
  var form = document.getElementById('pg-form');
  var input = document.getElementById('pg-code');
  var button = document.getElementById('pg-open');
  var msg = document.getElementById('pg-msg');
  function clean() { return input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  input.addEventListener('input', function () {
    input.value = clean().slice(0, cfg.length);
    button.disabled = input.value.length < cfg.length;
  });
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (clean().length < cfg.length || button.disabled) return;
    button.disabled = true;
    msg.textContent = '';
    fetch('/api/sign/' + cfg.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unlock', code: clean() })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (result) {
      if (result.ok) { window.location.reload(); return; }
      msg.textContent = (result.data && result.data.error) || 'That did not work. Please try again.';
      if (result.data && result.data.locked) {
        input.disabled = true;
        return;
      }
      input.value = '';
      input.focus();
    }).catch(function () {
      msg.textContent = 'Could not check the passcode. Check your connection and try again.';
      button.disabled = false;
    });
  });
  input.focus();
})();
`

/**
 * Shown before the document when the link has a passcode. Says nothing about
 * the document or the client: someone holding only the link learns the brand
 * name and no more.
 */
export function passcodeGatePage(d: { token: string; brandLabel: string; length: number }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(d.brandLabel)}</title>
</head>
<body style="margin:0;background:#d6e2f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111">
  <div style="max-width:420px;margin:12vh auto 0;padding:0 16px">
    <form id="pg-form" autocomplete="off" style="background:#fff;border-radius:14px;padding:28px 24px;box-shadow:0 8px 40px rgba(0,0,0,0.12)">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#FF6B35;margin-bottom:6px">${esc(d.brandLabel)}</div>
      <h1 style="font-size:20px;margin:0 0 8px">Enter your passcode</h1>
      <p style="font-size:15px;line-height:1.5;color:#333;margin:0 0 18px">
        <label for="pg-code">To open your document, enter the ${d.length}-character passcode you were given with this link.</label>
      </p>
      <input id="pg-code" name="code" type="text" inputmode="text" autocapitalize="characters" autocorrect="off" spellcheck="false" autocomplete="off" maxlength="${d.length}"
        style="display:block;width:100%;box-sizing:border-box;padding:14px 12px;border:1px solid #98a2b3;border-radius:10px;font:700 28px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0.4em;text-align:center;text-transform:uppercase;color:#111;background:#fff">
      <div id="pg-msg" role="alert" style="color:#b91c1c;font-size:14px;line-height:1.45;min-height:20px;margin:10px 0 8px"></div>
      <button id="pg-open" type="submit" disabled
        style="display:block;width:100%;border:none;border-radius:10px;padding:14px;font:700 16px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#FF6B35;color:#fff;cursor:pointer">Open document</button>
      <p style="font-size:12px;color:#666;line-height:1.5;margin:14px 0 0">No passcode? Contact ${esc(d.brandLabel)} and we will send it to you.</p>
    </form>
  </div>
  <style>#pg-open:disabled { opacity: 0.5; cursor: default; }</style>
  <script type="application/json" id="pg-config">${scriptJson({ token: d.token, length: d.length })}</script>
  <script>${GATE_SCRIPT}</script>
</body>
</html>`
}

/** A plain page for links that can no longer be used. */
export function signingMessagePage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(title)}</title>
</head>
<body style="margin:0;background:#d6e2f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111">
  <div style="max-width:480px;margin:12vh auto 0;padding:0 16px">
    <div style="background:#fff;border-radius:14px;padding:28px 24px;box-shadow:0 8px 40px rgba(0,0,0,0.12)">
      <h1 style="font-size:20px;margin:0 0 10px">${esc(title)}</h1>
      <p style="font-size:15px;line-height:1.55;color:#333;margin:0">${esc(body)}</p>
    </div>
  </div>
</body>
</html>`
}
