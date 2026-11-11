/*
 * lib/signing/shell.ts
 *
 * What the client sees around the document on their signing link: the bar
 * across the top, the "agree to sign electronically" screen, the fields lit up
 * in the document, the draw-or-type signature window, Finish and Decline.
 *
 * It is plain HTML, CSS and script added to the document page (the document is
 * already a complete HTML page, not a React screen), so it works on any phone
 * browser with nothing to load first. Nothing here is trusted: the server
 * checks every value again in /api/sign/[token].
 */

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
  #sg-root .sg-typed {
    border: 1px dashed #98a2b3; border-radius: 10px; background: #fcfcfd; height: 110px;
    display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 0 12px;
    font: italic 44px 'Snell Roundhand', 'Brush Script MT', 'Segoe Script', 'Lucida Handwriting', 'Apple Chancery', cursive;
    white-space: nowrap;
  }
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
  .sow-root .sign-block .sign-slot .sg-name {
    width: 100%; border: none; background: transparent; font: inherit; color: inherit; padding: 0; outline: none;
  }
  .sow-root .sign-block .sign-slot.sg-name-slot { background: #f5f9ff; border-radius: 6px 6px 0 0; }
  .sow-root .sign-block .sign-slot.sg-name-slot.sg-todo { background: #fff4c2; }
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
    #sg-root .sg-card { padding: 20px 18px; }
  }
  @media print { #sg-root { display: none !important; } }
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
})();
`

// String.raw keeps backslashes as written. The script below must not contain
// backticks or a dollar-brace, since it sits inside this template.
const SHELL_SCRIPT = String.raw`
(function () {
  var cfg = JSON.parse(document.getElementById('sg-config').textContent);
  var api = '/api/sign/' + cfg.token;
  var state = { signature: null, method: null, busy: false, finished: false };

  function $(id) { return document.getElementById(id); }
  function slot(name) { return document.querySelector('.sign-block [data-sign-slot="' + name + '"]'); }
  function post(body) {
    return fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error((data && data.error) || 'Something went wrong. Please try again.');
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
    toast('This document cannot be signed online. Please reply to the email you received.');
    return;
  }

  // ── Fields in the document ────────────────────────────────────────────────
  block.classList.add('sg-live');
  dateSlot.textContent = cfg.dateLabel;

  var nameInput = document.createElement('input');
  nameInput.className = 'sg-name';
  nameInput.type = 'text';
  nameInput.maxLength = 120;
  nameInput.autocomplete = 'name';
  nameInput.setAttribute('aria-label', 'Your full name');
  nameInput.placeholder = 'Your full name';
  nameInput.value = cfg.toName || '';
  nameSlot.classList.add('sg-name-slot');
  nameSlot.appendChild(nameInput);
  nameInput.addEventListener('input', refresh);

  sigSlot.setAttribute('role', 'button');
  sigSlot.setAttribute('tabindex', '0');
  sigSlot.setAttribute('aria-label', 'Sign here');
  sigSlot.addEventListener('click', openPad);
  sigSlot.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPad(); }
  });

  function nameValue() { return nameInput.value.replace(/\s+/g, ' ').trim(); }
  function nameOk() { return nameValue().length >= 2; }

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
    var done = (state.signature ? 1 : 0) + (nameOk() ? 1 : 0);
    nameSlot.classList.toggle('sg-todo', !nameOk());
    $('sg-progress').textContent = done + ' of 2 fields done';
    var next = $('sg-next');
    next.textContent = done === 2 ? 'Finish' : (state.started ? 'Next' : 'Start');
    next.disabled = state.busy;
  }

  function goToNextField() {
    state.started = true;
    var target = !state.signature ? sigSlot : nameSlot;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (target === nameSlot) { nameInput.focus({ preventScroll: true }); }
    else { sigSlot.focus({ preventScroll: true }); }
    refresh();
  }

  $('sg-next').addEventListener('click', function () {
    if (state.busy) return;
    if (state.signature && nameOk()) finish();
    else goToNextField();
  });

  // ── Agree to sign electronically ──────────────────────────────────────────
  var agree = $('sg-agree');
  var agreeBtn = $('sg-agree-continue');
  agree.addEventListener('change', function () { agreeBtn.disabled = !agree.checked; });
  agreeBtn.addEventListener('click', function () {
    hide('sg-consent');
    post({ action: 'consent' }).catch(function () {});
  });
  if (!cfg.consented) show('sg-consent');
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
    if (mode === 'type' && !nameOk()) nameInput.value = typed.value.replace(/\s+/g, ' ').trim();
    hide('sg-pad');
    renderSignature();
    state.started = true;
    refresh();
    if (!nameOk()) goToNextField();
  });

  // ── Finish ────────────────────────────────────────────────────────────────
  function finish() {
    state.busy = true;
    $('sg-next').textContent = 'Signing…';
    $('sg-next').disabled = true;
    post({ action: 'sign', name: nameValue(), signature: state.signature, method: state.method, agreed: true })
      .then(function (data) {
        state.finished = true;
        nameSlot.textContent = nameValue();
        nameSlot.classList.remove('sg-name-slot', 'sg-todo');
        if (data && data.dateLabel) dateSlot.textContent = data.dateLabel;
        block.classList.remove('sg-live');
        sigSlot.removeAttribute('role');
        sigSlot.removeAttribute('tabindex');
        sigSlot.classList.remove('sg-done');
        $('sg-progress').textContent = 'Signed';
        $('sg-next').style.display = 'none';
        $('sg-decline-open').style.display = 'none';
        show('sg-done');
      })
      .catch(function (err) {
        state.busy = false;
        refresh();
        toast(err && err.message ? err.message : 'Could not record your signature. Please try again.');
      });
  }

  // ── Decline ───────────────────────────────────────────────────────────────
  $('sg-decline-open').addEventListener('click', function () {
    if (state.busy || state.finished) return;
    $('sg-decline-error').textContent = '';
    show('sg-decline');
  });
  $('sg-decline-cancel').addEventListener('click', function () { hide('sg-decline'); });
  $('sg-decline-confirm').addEventListener('click', function () {
    var button = $('sg-decline-confirm');
    button.disabled = true;
    post({ action: 'decline', reason: $('sg-decline-reason').value })
      .then(function () {
        state.finished = true;
        hide('sg-decline');
        $('sg-next').style.display = 'none';
        $('sg-decline-open').style.display = 'none';
        $('sg-progress').textContent = 'Declined';
        block.classList.remove('sg-live');
        show('sg-declined');
      })
      .catch(function (err) {
        button.disabled = false;
        $('sg-decline-error').textContent = err && err.message ? err.message : 'Could not send that. Please try again.';
      });
  });

  renderSignature();
  refresh();
})();
`

export interface SigningShellData {
  token: string
  brandLabel: string
  documentTitle: string
  reference: string | null
  toName: string
  toEmail: string
  /** Today's date as it will be written in the Date field. The server sets the real one. */
  dateLabel: string
  consented: boolean
}

/** Everything added to the document page while it is waiting to be signed. */
export function signingShellHtml(d: SigningShellData): string {
  const docLine = `${d.documentTitle}${d.reference ? ` ${d.reference}` : ''}`
  const pdfUrl = `/api/sign/${encodeURIComponent(d.token)}/pdf`
  return `
  <div id="sg-root">
    <style>${SHELL_CSS}</style>
    <div id="sg-bar">
      <div class="sg-doc">
        <div class="sg-brand">${esc(d.brandLabel)}</div>
        <div class="sg-title">${esc(docLine)}</div>
      </div>
      <span class="sg-progress" id="sg-progress" aria-live="polite"></span>
      <button type="button" class="sg-btn sg-btn-quiet" id="sg-decline-open">Decline</button>
      <button type="button" class="sg-btn" id="sg-next">Start</button>
    </div>

    <div class="sg-overlay" id="sg-consent" role="dialog" aria-modal="true" aria-labelledby="sg-consent-h">
      <div class="sg-card">
        <div class="sg-eyebrow">${esc(d.brandLabel)}</div>
        <h2 id="sg-consent-h">Please review and sign</h2>
        <div class="sg-facts">
          <div><span>Document:</span> ${esc(docLine)}</div>
          <div><span>For:</span> ${esc(d.toName)} (${esc(d.toEmail)})</div>
        </div>
        <p>Read the document, then sign at the end. It takes about a minute, and a signed copy is emailed to you straight away.</p>
        <label class="sg-check">
          <input type="checkbox" id="sg-agree">
          <span>I agree to sign this document electronically, and that my electronic signature has the same effect as signing on paper.</span>
        </label>
        <div class="sg-actions">
          <button type="button" class="sg-btn" id="sg-agree-continue" disabled>Continue</button>
        </div>
        <p class="sg-small" style="margin:14px 0 0">Not the right person, or prefer paper? Reply to the email you received.</p>
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
        <p class="sg-small" style="margin:14px 0 16px">By choosing Adopt and sign, I agree this is my signature on this document.</p>
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
        <p>Your signed copy of ${esc(docLine)} is being emailed to ${esc(d.toEmail)}. You can also download it now.</p>
        <div class="sg-actions">
          <a class="sg-btn" href="${esc(pdfUrl)}" style="text-decoration:none;display:inline-block">Download signed copy</a>
        </div>
        <p class="sg-small" style="margin:14px 0 0">You can close this page.</p>
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
      toName: d.toName,
      dateLabel: d.dateLabel,
      consented: d.consented,
    })}</script>
    <script>${FIT_SCRIPT}</script>
    <script>${SHELL_SCRIPT}</script>
  </div>`
}

/** Bar shown above a document that has already been signed from this link. */
export function signedBannerHtml(d: {
  token: string
  brandLabel: string
  documentTitle: string
  reference: string | null
  signerName: string
  signedAtLabel: string
}): string {
  const docLine = `${d.documentTitle}${d.reference ? ` ${d.reference}` : ''}`
  return `
  <div id="sg-root">
    <style>${SHELL_CSS}</style>
    <div id="sg-bar">
      <div class="sg-doc">
        <div class="sg-brand">${esc(d.brandLabel)} · Signed</div>
        <div class="sg-title">${esc(docLine)} — signed by ${esc(d.signerName)}, ${esc(d.signedAtLabel)}</div>
      </div>
      <a class="sg-btn" href="/api/sign/${encodeURIComponent(d.token)}/pdf" style="text-decoration:none">Download signed copy</a>
    </div>
    <script>${FIT_SCRIPT}</script>
  </div>`
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
