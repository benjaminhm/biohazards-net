/*
 * lib/signing/slots.ts
 *
 * The fixed signature fields printed at the end of a quote that is sent for
 * signing: signature, full name, date. Standard documents, so the fields are
 * always in the same place; nobody drags them onto the page.
 *
 * The same markup is used three ways: printed empty in the document that is
 * sent, filled in live on the client's signing page, and filled in on the
 * server to produce the signed copy. Browser-safe (no Node imports) because
 * printDocument.ts is also bundled for the client.
 */

export const SIGN_SLOTS = ['signature', 'name', 'date'] as const
export type SignSlot = (typeof SIGN_SLOTS)[number]

const SLOT_CAPTIONS: Record<SignSlot, string> = {
  signature: 'Signature',
  name: 'Full name',
  date: 'Date',
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** One slot. `inner` must already be safe HTML. */
export function signSlotHtml(slot: SignSlot, inner = ''): string {
  return `<div class="sign-slot${inner ? ' sign-slot--filled' : ''}" data-sign-slot="${slot}">${inner}</div>`
}

/** The block printed at the end of the quote, with all three slots empty. */
export function signatureBlockHtml(): string {
  const field = (slot: SignSlot) => `
        <div class="sign-field sign-field--${slot}">
          ${signSlotHtml(slot)}
          <div class="sign-cap">${SLOT_CAPTIONS[slot]}</div>
        </div>`
  return `
    <div class="sign-block" id="sign-block">
      <div class="label">Acceptance and signature</div>
      <div class="body-text">By signing below, I accept this quote/estimate and its terms, and confirm I am authorised to accept it.</div>
      <div class="sign-grid">${SIGN_SLOTS.map(field).join('')}
      </div>
    </div>`
}

export function hasSignSlots(html: string): boolean {
  return SIGN_SLOTS.every(slot => html.includes(signSlotHtml(slot)))
}

export interface SignSlotValues {
  /** A validated `data:image/png;base64,…` URL. */
  signaturePng: string
  name: string
  dateLabel: string
}

/**
 * Put the signer's values into the empty slots. Throws when a slot is missing,
 * so a signed copy is never produced with the signature silently left out.
 */
export function fillSignSlots(html: string, values: SignSlotValues): string {
  const inner: Record<SignSlot, string> = {
    signature: `<img src="${esc(values.signaturePng)}" alt="Signature">`,
    name: esc(values.name),
    date: esc(values.dateLabel),
  }
  let out = html
  for (const slot of SIGN_SLOTS) {
    const empty = signSlotHtml(slot)
    if (!out.includes(empty)) throw new Error(`Signature field "${slot}" is missing from the document`)
    // Function replacer: a "$" in a name must not be read as a replacement pattern.
    out = out.replace(empty, () => signSlotHtml(slot, inner[slot]))
  }
  return out
}
