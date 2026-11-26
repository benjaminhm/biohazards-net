import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib";
import type { JobWorkspace, OpCoScope } from "./types";
import { calcTotals, formatAUD } from "./utils";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 44;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

const NAVY = rgb(0.06, 0.09, 0.16);
const SLATE_700 = rgb(0.2, 0.25, 0.33);
const SLATE_500 = rgb(0.39, 0.45, 0.54);
const SLATE_200 = rgb(0.88, 0.91, 0.94);
const SLATE_50 = rgb(0.97, 0.98, 0.99);
const EMERALD = rgb(0.02, 0.47, 0.34);
const EMERALD_BG = rgb(0.92, 0.98, 0.95);
const AMBER = rgb(0.71, 0.33, 0.04);
const AMBER_BG = rgb(1, 0.97, 0.9);
const WHITE = rgb(1, 1, 1);

function safeText(input: string): string {
  return (input || "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2022/g, "*")
    .replace(/\u00B7/g, "|")
    .replace(/\u2192/g, "->")
    .replace(/\u2264/g, "<=")
    .replace(/\u2265/g, ">=")
    .replace(/\u00D7/g, "x")
    .replace(/\u00B3/g, "3")
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const clean = safeText(text);
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

class PdfBuilder {
  doc!: PDFDocument;
  font!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = A4_HEIGHT - MARGIN;
  footerText = "";

  async init(title: string, footerText: string) {
    this.doc = await PDFDocument.create();
    this.doc.setTitle(safeText(title));
    this.doc.setProducer("Hazmat Management Co-Bid Workspace");
    this.font = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.footerText = safeText(footerText);
    this.addPage();
  }

  addPage() {
    this.page = this.doc.addPage([A4_WIDTH, A4_HEIGHT]);
    this.y = A4_HEIGHT - MARGIN;
  }

  ensureSpace(needed: number) {
    if (this.y - needed < MARGIN + 28) {
      this.addPage();
    }
  }

  drawHeaderBanner(eyebrow: string, title: string, rightTop: string, rightBottom: string) {
    const h = 68;
    this.page.drawRectangle({
      x: 0,
      y: A4_HEIGHT - h,
      width: A4_WIDTH,
      height: h,
      color: NAVY,
    });
    this.page.drawText(safeText(eyebrow.toUpperCase()), {
      x: MARGIN,
      y: A4_HEIGHT - 24,
      size: 8,
      font: this.bold,
      color: rgb(0.65, 0.72, 0.82),
    });
    this.page.drawText(safeText(title), {
      x: MARGIN,
      y: A4_HEIGHT - 44,
      size: 15,
      font: this.bold,
      color: WHITE,
    });

    const rt = safeText(rightTop);
    const rb = safeText(rightBottom);
    const rtW = this.bold.widthOfTextAtSize(rt, 10);
    const rbW = this.font.widthOfTextAtSize(rb, 8.5);

    this.page.drawText(rt, {
      x: A4_WIDTH - MARGIN - rtW,
      y: A4_HEIGHT - 28,
      size: 10,
      font: this.bold,
      color: WHITE,
    });
    this.page.drawText(rb, {
      x: A4_WIDTH - MARGIN - rbW,
      y: A4_HEIGHT - 43,
      size: 8.5,
      font: this.font,
      color: rgb(0.75, 0.8, 0.88),
    });

    this.y = A4_HEIGHT - h - 22;
  }

  drawSectionTitle(title: string) {
    this.ensureSpace(28);
    this.page.drawText(safeText(title.toUpperCase()), {
      x: MARGIN,
      y: this.y,
      size: 8.5,
      font: this.bold,
      color: SLATE_500,
    });
    this.y -= 6;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: A4_WIDTH - MARGIN, y: this.y },
      thickness: 0.75,
      color: SLATE_200,
    });
    this.y -= 14;
  }

  drawParagraph(
    text: string,
    opts?: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number }
  ) {
    const size = opts?.size ?? 9.5;
    const font = opts?.bold ? this.bold : this.font;
    const color = opts?.color ?? SLATE_700;
    const indent = opts?.indent ?? 0;
    const lines = wrapText(text, font, size, CONTENT_WIDTH - indent);
    const lineHeight = size + 4;

    for (const line of lines) {
      this.ensureSpace(lineHeight + 4);
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y,
        size,
        font,
        color,
      });
      this.y -= lineHeight;
    }
    this.y -= 4;
  }

  drawCalloutBox(title: string, body: string, tone: "slate" | "emerald" | "amber" = "slate") {
    const bg = tone === "emerald" ? EMERALD_BG : tone === "amber" ? AMBER_BG : SLATE_50;
    const border = tone === "emerald" ? EMERALD : tone === "amber" ? AMBER : SLATE_200;
    const titleColor = tone === "emerald" ? EMERALD : tone === "amber" ? AMBER : NAVY;

    const lines = wrapText(body, this.font, 8.8, CONTENT_WIDTH - 24);
    const boxH = 26 + lines.length * 12.5 + 8;
    this.ensureSpace(boxH + 10);

    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - boxH + 10,
      width: CONTENT_WIDTH,
      height: boxH,
      color: bg,
      borderColor: border,
      borderWidth: 0.8,
    });

    this.page.drawText(safeText(title), {
      x: MARGIN + 12,
      y: this.y - 6,
      size: 9.5,
      font: this.bold,
      color: titleColor,
    });

    let lineY = this.y - 21;
    for (const line of lines) {
      this.page.drawText(line, {
        x: MARGIN + 12,
        y: lineY,
        size: 8.8,
        font: this.font,
        color: SLATE_700,
      });
      lineY -= 12.5;
    }
    this.y -= boxH + 8;
  }

  drawLineItemsTable(opCo: OpCoScope, includeVariations: boolean) {
    const headers = [
      { label: "CODE", x: MARGIN + 6, width: 52 },
      { label: "DESCRIPTION", x: MARGIN + 60, width: 255 },
      { label: "UNIT", x: MARGIN + 320, width: 52 },
      { label: "QTY", x: MARGIN + 375, width: 35, right: true },
      { label: "RATE", x: MARGIN + 412, width: 65, right: true },
      { label: "EX GST", x: MARGIN + 480, width: 65, right: true },
    ];

    this.ensureSpace(40);
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - 16,
      width: CONTENT_WIDTH,
      height: 20,
      color: SLATE_50,
      borderColor: SLATE_200,
      borderWidth: 0.6,
    });

    for (const h of headers) {
      const text = h.label;
      const x = h.right ? h.x + h.width - this.bold.widthOfTextAtSize(text, 7.5) : h.x;
      this.page.drawText(text, {
        x,
        y: this.y - 10,
        size: 7.5,
        font: this.bold,
        color: SLATE_500,
      });
    }
    this.y -= 24;

    const rows = opCo.lineItems.map((li) => ({
      code: li.code,
      desc: li.description,
      unit: li.unit,
      qty: String(li.qty),
      rate: formatAUD(li.unitPrice),
      total: formatAUD(li.qty * li.unitPrice),
    }));

    if (includeVariations) {
      for (const v of opCo.variations.filter((x) => x.status === "approved")) {
        rows.push({
          code: v.reference,
          desc: `Approved Variation: ${v.title}`,
          unit: "Allow",
          qty: "1",
          rate: formatAUD(v.amountExGst),
          total: formatAUD(v.amountExGst),
        });
      }
    }

    for (const r of rows) {
      const descLines = wrapText(r.desc, this.font, 8.5, 250);
      const rowH = Math.max(18, descLines.length * 11.5 + 6);
      this.ensureSpace(rowH + 6);

      this.page.drawText(safeText(r.code), {
        x: MARGIN + 6,
        y: this.y - 2,
        size: 8,
        font: this.font,
        color: SLATE_500,
      });

      let dy = this.y - 2;
      for (const dl of descLines) {
        this.page.drawText(dl, {
          x: MARGIN + 60,
          y: dy,
          size: 8.5,
          font: this.font,
          color: NAVY,
        });
        dy -= 11.5;
      }

      this.page.drawText(safeText(r.unit), {
        x: MARGIN + 320,
        y: this.y - 2,
        size: 8.5,
        font: this.font,
        color: SLATE_500,
      });

      const drawRight = (val: string, colX: number, colW: number, isBold = false) => {
        const f = isBold ? this.bold : this.font;
        const t = safeText(val);
        this.page.drawText(t, {
          x: colX + colW - f.widthOfTextAtSize(t, 8.5),
          y: this.y - 2,
          size: 8.5,
          font: f,
          color: isBold ? NAVY : SLATE_700,
        });
      };

      drawRight(r.qty, MARGIN + 375, 35);
      drawRight(r.rate, MARGIN + 412, 65);
      drawRight(r.total, MARGIN + 480, 65, true);

      this.y -= rowH;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y + 4 },
        end: { x: A4_WIDTH - MARGIN, y: this.y + 4 },
        thickness: 0.4,
        color: SLATE_200,
      });
    }
    this.y -= 8;
  }

  async finalize(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    const total = pages.length;
    pages.forEach((p, idx) => {
      p.drawLine({
        start: { x: MARGIN, y: 34 },
        end: { x: A4_WIDTH - MARGIN, y: 34 },
        thickness: 0.5,
        color: SLATE_200,
      });
      p.drawText(this.footerText, {
        x: MARGIN,
        y: 22,
        size: 7.5,
        font: this.font,
        color: SLATE_500,
      });
      const pg = `Page ${idx + 1} of ${total}`;
      p.drawText(pg, {
        x: A4_WIDTH - MARGIN - this.font.widthOfTextAtSize(pg, 7.5),
        y: 22,
        size: 7.5,
        font: this.font,
        color: SLATE_500,
      });
    });
    return this.doc.save();
  }
}

export async function buildAgreementPdf(job: JobWorkspace, opCo: OpCoScope): Promise<Uint8Array> {
  const b = new PdfBuilder();
  await b.init(
    `Independent Agreement ${opCo.agreementRef} - ${opCo.companyName}`,
    `Independent Contract ${opCo.agreementRef} | ${opCo.companyName} (ABN ${opCo.abn}) | Facilitated via Hazmat Management Co-Bid ${job.reference}`
  );

  const totals = calcTotals(opCo.lineItems, opCo.depositPercent, opCo.variations);

  b.drawHeaderBanner(
    `INDEPENDENT SERVICE AGREEMENT | ${opCo.agreementRef}`,
    opCo.companyName,
    `ABN ${opCo.abn}`,
    `Licence ${opCo.licenceNumber}`
  );

  b.drawCalloutBox(
    "CLAUSE 1 - INDEPENDENT CONTRACTING PARTY (NO PARTNERSHIP OR SUBCONTRACT)",
    `This Agreement is entered into directly and solely between ${job.clientName} ("Client") and ${opCo.companyName} (ABN ${opCo.abn}) ("Contractor") for the discrete trade scope of ${opCo.tradeCategory} at ${job.propertyAddress}, ${job.suburbState}. Neither Hazmat Management Co-Bid nor any other remediation company operating in Workspace ${job.reference} is a partner, joint venturer, agent, or head contractor to this Agreement.`,
    "slate"
  );

  b.drawSectionTitle("Contracting Parties & Property");
  b.drawParagraph(`Client: ${job.clientName} (${job.clientRole}) | ${job.clientEmail} | ${job.clientPhone}`);
  b.drawParagraph(`Contractor (OpCo): ${opCo.companyName} | ABN ${opCo.abn} | Contact: ${opCo.contactName} (${opCo.contactEmail})`);
  b.drawParagraph(`Site Address: ${job.propertyAddress}, ${job.suburbState} | Workspace Ref: ${job.reference} | Stage ${opCo.sequenceOrder}`);

  b.drawSectionTitle("Approved Scope of Works & Deliverables");
  b.drawParagraph(opCo.scopeSummary);
  for (const d of opCo.scopeDeliverables) {
    b.drawParagraph(`* ${d}`, { size: 9, indent: 8 });
  }

  if (opCo.exclusions.length > 0) {
    b.drawSectionTitle("Scope Boundaries & Exclusions");
    for (const ex of opCo.exclusions) {
      b.drawParagraph(`* ${ex}`, { size: 8.8, indent: 8, color: SLATE_500 });
    }
  }

  b.drawSectionTitle("Schedule of Rates & Consideration (AUD)");
  b.drawLineItemsTable(opCo, false);

  b.ensureSpace(70);
  b.drawParagraph(
    `Subtotal (ex GST): ${formatAUD(totals.baseSubtotal)}   |   GST (10%): ${formatAUD(totals.baseSubtotal * 0.1)}   |   Contract Price (inc. GST): ${formatAUD(totals.baseSubtotal * 1.1)}`,
    { bold: true, color: NAVY }
  );
  b.drawParagraph(
    job.settlementRail === "direct_to_opco"
      ? `Direct Deposit (${opCo.depositPercent}%): ${formatAUD(totals.depositAmount)} payable directly to ${opCo.companyName} (${opCo.bankName} BSB ${opCo.bsb} Acc ${opCo.accountNumber} | PayID ${opCo.payId}).`
      : `Deposit (${opCo.depositPercent}%): ${formatAUD(totals.depositAmount)} settled via Statutory Clearing Trust (Sub-Ledger ${opCo.monogram}) and disbursed directly to ${opCo.companyName}.`,
    { size: 8.8 }
  );

  b.drawSectionTitle("Electronic Execution & Audit Record");
  if (opCo.agreementStatus === "signed") {
    b.drawCalloutBox(
      `EXECUTED ELECTRONICALLY BY ${opCo.clientSignedBy?.toUpperCase() || job.clientName.toUpperCase()}`,
      `Signed on: ${opCo.clientSignedAt || "Recorded"} | Audit Digest: ${opCo.agreementAuditHash || "Verified"} | Executed under the Electronic Transactions Act directly with ${opCo.companyName} (ABN ${opCo.abn}).`,
      "emerald"
    );
  } else {
    b.drawCalloutBox(
      "PENDING CLIENT E-SIGNATURE",
      `Status: ${opCo.agreementStatus.replace(/_/g, " ").toUpperCase()} | OpCo Scope Approved: ${opCo.contractorApprovedAt || "Pending"}. This agreement becomes legally binding upon electronic signature by ${job.clientName}.`,
      "amber"
    );
  }

  return b.finalize();
}

export async function buildTaxInvoicePdf(job: JobWorkspace, opCo: OpCoScope): Promise<Uint8Array> {
  const b = new PdfBuilder();
  await b.init(
    `Tax Invoice ${opCo.balanceInvoiceRef} - ${opCo.companyName}`,
    `TAX INVOICE ${opCo.balanceInvoiceRef} issued directly by ${opCo.companyName} (ABN ${opCo.abn})`
  );

  const totals = calcTotals(opCo.lineItems, opCo.depositPercent, opCo.variations);
  const depositPaid = opCo.depositStatus === "paid" ? totals.depositAmount : 0;
  const amountDue = opCo.balanceStatus === "paid" ? 0 : totals.totalIncGst - depositPaid;

  b.drawHeaderBanner(
    `TAX INVOICE | ISSUED DIRECTLY BY OPERATING COMPANY`,
    opCo.companyName,
    opCo.balanceInvoiceRef,
    `ABN ${opCo.abn}`
  );

  b.drawSectionTitle("Invoice & Billing Details");
  b.drawParagraph(`Supplier: ${opCo.companyName} | ABN ${opCo.abn} | Licence ${opCo.licenceNumber}`);
  b.drawParagraph(`Bill To: ${job.clientName} (${job.clientEmail}) | Site: ${job.propertyAddress}, ${job.suburbState}`);
  b.drawParagraph(`Agreement Ref: ${opCo.agreementRef} | Workspace: ${job.reference} | Trade: ${opCo.tradeCategory}`);

  b.drawSectionTitle("Itemised Schedule (Including Approved Variations)");
  b.drawLineItemsTable(opCo, true);

  b.ensureSpace(100);
  b.drawParagraph(`Subtotal (ex GST): ${formatAUD(totals.subtotal)}`, { size: 9.5 });
  b.drawParagraph(`GST (10%): ${formatAUD(totals.gst)}`, { size: 9.5 });
  b.drawParagraph(`Total Contract Value (inc. GST): ${formatAUD(totals.totalIncGst)}`, {
    size: 10,
    bold: true,
    color: NAVY,
  });
  b.drawParagraph(
    `Less Direct Deposit ${
      opCo.depositStatus === "paid"
        ? `(Settled ${opCo.depositPaidAt} | Ref ${opCo.depositPaymentRef})`
        : "(Unpaid)"
    }: -${formatAUD(depositPaid)}`,
    { size: 9.5, color: EMERALD }
  );
  b.drawParagraph(`FINAL BALANCE DUE: ${formatAUD(amountDue)}`, {
    size: 12,
    bold: true,
    color: NAVY,
  });

  if (opCo.balanceStatus === "paid") {
    b.drawCalloutBox(
      "PAID IN FULL",
      `Final balance settled on ${opCo.balancePaidAt} (Ref ${opCo.balancePaymentRef}) directly to ${opCo.companyName}.`,
      "emerald"
    );
  } else {
    b.drawCalloutBox(
      job.settlementRail === "direct_to_opco"
        ? `DIRECT PAYMENT INSTRUCTIONS - ${opCo.companyName.toUpperCase()}`
        : `STATUTORY TRUST CLEARING SETTLEMENT - SUB-LEDGER ${opCo.monogram}`,
      job.settlementRail === "direct_to_opco"
        ? `Bank: ${opCo.bankName} | BSB: ${opCo.bsb} | Account: ${opCo.accountNumber} | PayID: ${opCo.payId} | Please quote reference ${opCo.balanceInvoiceRef}.`
        : `Settle ${formatAUD(amountDue)} into Statutory Clearing Trust referencing ${opCo.balanceInvoiceRef}. Funds auto-disburse directly to ${opCo.companyName} (ABN ${opCo.abn}).`,
      "slate"
    );
  }

  b.drawParagraph(
    `Legal Notice: This Tax Invoice is issued solely by ${opCo.companyName} (ABN ${opCo.abn}). Hazmat Management Co-Bid is a neutral workspace facilitator and is not the supplier of these services.`,
    { size: 8, color: SLATE_500 }
  );

  return b.finalize();
}

export async function buildCompletionPackPdf(job: JobWorkspace): Promise<Uint8Array> {
  const b = new PdfBuilder();
  await b.init(
    `Completion & Compliance Pack - ${job.reference}`,
    `Hazmat Management Co-Bid Handover Dossier | ${job.reference} | ${job.propertyAddress}, ${job.suburbState}`
  );

  const allDone = job.opCos.every((o) => o.completionSignedOff);

  b.drawHeaderBanner(
    `REMEDIATION COMPLETION & COMPLIANCE PACK | ${job.reference}`,
    `${job.propertyAddress}, ${job.suburbState}`,
    allDone ? "CERTIFIED COMPLETE" : "IN PROGRESS",
    job.title
  );

  b.drawSectionTitle("Property, Client & Lead Provenance");
  b.drawParagraph(`Client / Representative: ${job.clientName} (${job.clientRole}) | ${job.clientEmail}`);
  b.drawParagraph(`Lead Origin: ${job.leadSource} (${job.leadSourceType}) | Scoping Desk: ${job.coordinatorName}`);
  b.drawParagraph(`Independent Participating OpCos: ${job.opCos.length} sequenced remediation contractors`);

  for (const opCo of job.opCos) {
    const totals = calcTotals(opCo.lineItems, opCo.depositPercent, opCo.variations);
    b.drawSectionTitle(
      `Stage ${opCo.sequenceOrder}: ${opCo.companyName} (ABN ${opCo.abn}) - ${opCo.tradeCategory}`
    );
    b.drawParagraph(
      `Agreement Ref: ${opCo.agreementRef} | Licence: ${opCo.licenceNumber} | Contract Value: ${formatAUD(totals.totalIncGst)} inc. GST`,
      { size: 8.8, color: SLATE_500 }
    );
    b.drawParagraph(opCo.scopeSummary, { size: 9 });

    for (const m of opCo.milestones) {
      const statusStr =
        m.status === "completed"
          ? `[COMPLETED ${m.completedAt || ""}]`
          : `[${m.status.toUpperCase()}]`;
      b.drawParagraph(`* ${m.title} ${statusStr}`, { size: 8.8, indent: 8 });
    }

    for (const doc of opCo.complianceDocs) {
      b.drawParagraph(
        `Certificate: ${doc.title} | Ref: ${doc.reference} | Issued: ${doc.issuedAt} | Status: ${doc.status.toUpperCase()}`,
        { size: 8.5, indent: 8, color: doc.status === "verified" ? EMERALD : SLATE_500 }
      );
    }

    if (opCo.completionSignedOff) {
      b.drawCalloutBox(
        `STAGE ${opCo.sequenceOrder} CERTIFIED COMPLETE (${opCo.completionSignedAt})`,
        opCo.completionNotes ||
          `All deliverables completed in accordance with Agreement ${opCo.agreementRef}.`,
        "emerald"
      );
    } else {
      b.drawCalloutBox(
        `STAGE ${opCo.sequenceOrder} PENDING FINAL OPCO SIGN-OFF`,
        `${opCo.companyName} has not yet issued final completion certification for this scope.`,
        "amber"
      );
    }
  }

  b.drawCalloutBox(
    "STATUTORY WARRANTY & LEGAL SEPARATION DISCLAIMER",
    "This handover dossier compiles independent completion certifications and compliance certificates from each Operating Company for convenience. Each Operating Company remains solely and independently liable for the workmanship, statutory warranties, and regulatory compliance of its own contracted scope. No partnership or head-contractor/subcontractor relationship exists.",
    "slate"
  );

  return b.finalize();
}
