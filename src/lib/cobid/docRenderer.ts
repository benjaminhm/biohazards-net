/*
 * lib/cobid/docRenderer.ts
 *
 * Renders a standalone, self-contained HTML snapshot for ONE independent OpCo's
 * Quote & Service Agreement. Each OpCo gets its own frozen snapshot, own URL on
 * docs.hazmatmanagement.com.au/<token>, own logo/ABN/T&Cs, and own legal notice.
 */
import { QUOTE_TYPE_META, type DirectoryOpCo, type JobWorkspace, type OpCoScope } from "./types";
import { calcTotals, formatAUD, todayAuLabel } from "./utils";

function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nl2br(s: string): string {
  return esc(s).replace(/\n/g, "<br/>");
}

export function renderIndependentEntityDocHtml(params: {
  workspace: JobWorkspace;
  scope: OpCoScope;
  directoryOpCo?: DirectoryOpCo | null;
  logoUrl?: string | null;
}): string {
  const { workspace, scope, directoryOpCo, logoUrl } = params;
  const qtMeta = QUOTE_TYPE_META[scope.quoteType] ?? QUOTE_TYPE_META.custom;
  const gstRegistered = directoryOpCo ? directoryOpCo.gstRegistered : true;
  const totals = calcTotals(scope.lineItems, scope.depositPercent, scope.variations);
  const gstAmount = gstRegistered ? totals.baseSubtotal * 0.1 : 0;
  const contractTotal = totals.baseSubtotal + gstAmount;
  const depositAmount = contractTotal * (scope.depositPercent / 100);

  const legalName = directoryOpCo?.legalEntityName || scope.companyName;
  const tradingName = directoryOpCo?.tradingName || scope.companyName;
  const acn = directoryOpCo?.acn || "";
  const phone = directoryOpCo?.phone || "";
  const termsText =
    directoryOpCo?.termsAndConditions?.trim() ||
    `1. Independent Contract: This quote and service agreement is strictly between the Client and ${legalName} (ABN ${scope.abn || "provided on invoice"}). Neither Hazmat Management Co-Bid nor any other specialist contractor scheduled at the property is a partner, joint venturer, agent, or head contractor.\n2. Deposit & Mobilisation: Works are scheduled upon execution of this agreement and receipt of the ${scope.depositPercent}% deposit directly into ${legalName}'s nominated bank account or Xero Online Invoice.\n3. Scope & Variations: Only the itemised deliverables listed above are included. Any unforeseen site conditions or additional works require a written variation approved by the Client prior to execution.\n4. Site Access & Handover: Client warrants safe legal access to the property. Where this scope forms Stage ${scope.sequenceOrder} of a sequenced remediation program, mobilisation commences upon clearance of upstream handover prerequisites.`;

  const sd = scope.structuredQuoteData ?? {};
  const structuredRows: Array<{ label: string; value: string }> = [];
  if (sd.hazardClassification) {
    structuredRows.push({ label: "Hazard / Scope Classification", value: sd.hazardClassification });
  }
  if (Array.isArray(sd.roomsOrZones) && sd.roomsOrZones.length > 0) {
    structuredRows.push({ label: "Rooms / Affected Zones", value: sd.roomsOrZones.join(", ") });
  }
  if (Array.isArray(sd.standardsApplied) && sd.standardsApplied.length > 0) {
    structuredRows.push({ label: "Standards & Protocols", value: sd.standardsApplied.join(" · ") });
  }
  if (sd.ppeAndContainment) {
    structuredRows.push({ label: "PPE & Containment Controls", value: sd.ppeAndContainment });
  }
  if (sd.wasteDisposalNotes) {
    structuredRows.push({ label: "Waste & Disposal Protocol", value: sd.wasteDisposalNotes });
  }
  if (sd.siteConditions) {
    structuredRows.push({ label: "Site Conditions Noted", value: sd.siteConditions });
  }
  if (sd.estimatedDuration) {
    structuredRows.push({ label: "Estimated Duration", value: sd.estimatedDuration });
  }
  if (sd.specialNotes) {
    structuredRows.push({ label: "Additional Estimator Notes", value: sd.specialNotes });
  }

  const lineItemRowsHtml = scope.lineItems
    .map(
      (li) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;color:#64748b;white-space:nowrap;">${esc(li.code)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a;">
          <div style="font-weight:500;">${esc(li.description)}</div>
          <div style="font-size:11px;color:#64748b;">${esc(li.category)}</div>
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569;text-align:right;white-space:nowrap;">${li.qty} ${esc(li.unit)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569;text-align:right;white-space:nowrap;">${esc(formatAUD(li.unitPrice))}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#0f172a;text-align:right;white-space:nowrap;">${esc(formatAUD(li.qty * li.unitPrice))}</td>
      </tr>`
    )
    .join("");

  return `
<article style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;line-height:1.55;">
  <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:20px;border-bottom:2px solid #0f172a;">
    <div style="display:flex;align-items:center;gap:14px;">
      ${
        logoUrl
          ? `<img src="${esc(logoUrl)}" alt="${esc(tradingName)}" style="height:52px;max-width:160px;object-fit:contain;border-radius:8px;border:1px solid #e2e8f0;background:#fff;padding:4px;" />`
          : `<div style="width:48px;height:48px;border-radius:10px;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;letter-spacing:0.04em;">${esc(scope.monogram)}</div>`
      }
      <div>
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#475569;">
          ${esc(qtMeta.code)} · ${esc(qtMeta.label)}
        </div>
        <h1 style="margin:2px 0 0;font-size:20px;font-weight:700;color:#0f172a;">${esc(tradingName)}</h1>
        <div style="font-size:12px;color:#475569;margin-top:2px;">
          ${legalName !== tradingName ? `Legal Entity: ${esc(legalName)} · ` : ""}ABN ${esc(scope.abn || "TBA")}${acn ? ` · ACN ${esc(acn)}` : ""}${scope.licenceNumber ? ` · Licence ${esc(scope.licenceNumber)}` : ""}
        </div>
      </div>
    </div>
    <div style="text-align:right;font-size:12px;color:#475569;">
      <div style="font-weight:700;font-size:14px;color:#0f172a;">Job Ref: ${esc(scope.independentJobRef || scope.agreementRef)}</div>
      <div>Agreement: ${esc(scope.agreementRef)}</div>
      <div>Issued: ${esc(todayAuLabel())} · Stage ${scope.sequenceOrder}</div>
    </div>
  </div>

  <div style="margin:18px 0;padding:12px 14px;border-radius:10px;background:#f8fafc;border:1px solid #cbd5e1;font-size:12px;color:#334155;">
    <strong style="color:#0f172a;">Independent Operating Entity Notice:</strong>
    This quote and agreement is issued solely and independently by <strong>${esc(legalName)} (ABN ${esc(scope.abn || "TBA")})</strong>.
    This is <strong>not</strong> a partnership, joint venture, or subcontracting arrangement. You are contracting directly with ${esc(legalName)} for the discrete scope below, with a separate invoice and direct payment.
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:16px 0;">
    <div style="padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px;background:#ffffff;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Prepared For (Client)</div>
      <div style="font-size:14px;font-weight:600;color:#0f172a;margin-top:4px;">${esc(workspace.clientName)}</div>
      <div style="font-size:12px;color:#475569;">${esc(workspace.clientRole)}</div>
      ${workspace.clientEmail ? `<div style="font-size:12px;color:#475569;">${esc(workspace.clientEmail)}</div>` : ""}
      ${workspace.clientPhone ? `<div style="font-size:12px;color:#475569;">${esc(workspace.clientPhone)}</div>` : ""}
    </div>
    <div style="padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px;background:#ffffff;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Site &amp; Contractor Contact</div>
      <div style="font-size:14px;font-weight:600;color:#0f172a;margin-top:4px;">${esc(workspace.propertyAddress)}</div>
      <div style="font-size:12px;color:#475569;">${esc(workspace.suburbState)}</div>
      <div style="font-size:12px;color:#475569;margin-top:4px;">Estimator: ${esc(scope.contactName)}${phone ? ` · ${esc(phone)}` : ""}</div>
      ${scope.contactEmail ? `<div style="font-size:12px;color:#475569;">${esc(scope.contactEmail)}</div>` : ""}
    </div>
  </div>

  <section style="margin-top:22px;">
    <h2 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#475569;margin:0 0 8px;">Scope of Works — ${esc(scope.tradeCategory)}</h2>
    <p style="font-size:14px;color:#1e293b;margin:0 0 12px;">${nl2br(scope.scopeSummary || "As itemised in the schedule below.")}</p>

    ${
      structuredRows.length > 0
        ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:14px 0;">
            ${structuredRows
              .map(
                (r) => `<div style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                  <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;">${esc(r.label)}</div>
                  <div style="font-size:13px;color:#0f172a;margin-top:3px;">${nl2br(r.value)}</div>
                </div>`
              )
              .join("")}
          </div>`
        : ""
    }

    ${
      scope.scopeDeliverables.length > 0
        ? `<div style="margin-top:12px;">
            <div style="font-size:12px;font-weight:600;color:#0f172a;margin-bottom:6px;">Included Deliverables</div>
            <ul style="margin:0;padding-left:18px;font-size:13px;color:#334155;">
              ${scope.scopeDeliverables.map((d) => `<li style="margin-bottom:4px;">${esc(d)}</li>`).join("")}
            </ul>
          </div>`
        : ""
    }

    ${
      scope.exclusions.length > 0
        ? `<div style="margin-top:14px;padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;">
            <div style="font-size:12px;font-weight:600;color:#0f172a;margin-bottom:6px;">Scope Boundaries &amp; Exclusions</div>
            <ul style="margin:0;padding-left:18px;font-size:12px;color:#475569;">
              ${scope.exclusions.map((e) => `<li style="margin-bottom:3px;">${esc(e)}</li>`).join("")}
            </ul>
          </div>`
        : ""
    }
  </section>

  <section style="margin-top:24px;">
    <h2 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#475569;margin:0 0 8px;">Itemised Quote Pricing (AUD)</h2>
    <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">
            <th style="text-align:left;padding:9px 8px;font-size:11px;color:#64748b;text-transform:uppercase;">Code</th>
            <th style="text-align:left;padding:9px 8px;font-size:11px;color:#64748b;text-transform:uppercase;">Description</th>
            <th style="text-align:right;padding:9px 8px;font-size:11px;color:#64748b;text-transform:uppercase;">Qty</th>
            <th style="text-align:right;padding:9px 8px;font-size:11px;color:#64748b;text-transform:uppercase;">Rate</th>
            <th style="text-align:right;padding:9px 8px;font-size:11px;color:#64748b;text-transform:uppercase;">Ex GST</th>
          </tr>
        </thead>
        <tbody>
          ${lineItemRowsHtml}
        </tbody>
      </table>
    </div>

    <div style="margin-top:14px;margin-left:auto;max-width:320px;padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;font-size:13px;">
      <div style="display:flex;justify-content:space-between;color:#475569;margin-bottom:4px;">
        <span>Subtotal (ex GST)</span>
        <span>${esc(formatAUD(totals.baseSubtotal))}</span>
      </div>
      <div style="display:flex;justify-content:space-between;color:#475569;margin-bottom:8px;">
        <span>GST ${gstRegistered ? "(10%)" : "(Not GST Registered)"}</span>
        <span>${esc(formatAUD(gstAmount))}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-weight:700;font-size:15px;color:#0f172a;padding-top:8px;border-top:1px solid #cbd5e1;">
        <span>Total ${gstRegistered ? "(inc. GST)" : "(AUD)"}</span>
        <span>${esc(formatAUD(contractTotal))}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-weight:600;font-size:12px;color:#047857;margin-top:8px;padding-top:8px;border-top:1px dashed #cbd5e1;">
        <span>Direct Deposit (${scope.depositPercent}%)</span>
        <span>${esc(formatAUD(depositAmount))}</span>
      </div>
    </div>
  </section>

  <section style="margin-top:22px;padding:14px 16px;border:1px solid #e2e8f0;border-radius:10px;background:#ffffff;">
    <h2 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#475569;margin:0 0 8px;">Direct Payment Details — ${esc(legalName)}</h2>
    <div style="font-size:12px;color:#334155;">
      Upon signing this agreement, ${esc(legalName)} will issue your deposit invoice directly.
      ${
        scope.bankName || scope.bsb || scope.accountNumber || scope.payId
          ? `<div style="margin-top:6px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;color:#0f172a;">
              ${scope.bankName ? `Bank: ${esc(scope.bankName)} · ` : ""}${scope.bsb ? `BSB: ${esc(scope.bsb)} · ` : ""}${scope.accountNumber ? `Acc: ${esc(scope.accountNumber)}` : ""}${scope.payId ? ` · PayID: ${esc(scope.payId)}` : ""}
            </div>`
          : ""
      }
    </div>
  </section>

  <section style="margin-top:22px;padding-top:16px;border-top:1px solid #e2e8f0;">
    <h2 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#475569;margin:0 0 8px;">${esc(tradingName)} Terms &amp; Conditions</h2>
    <div style="font-size:12px;color:#475569;line-height:1.6;">
      ${nl2br(termsText)}
    </div>
  </section>
</article>
`.trim();
}
