/*
 * lib/cobid/email.ts
 *
 * Transactional emails for Co-Bid via Resend:
 *  - Workspace magic-link invites (OpCo / Client)
 *  - OpCo partner onboarding invites
 *  - OpCo BCQ/SACQ quote-builder job invites
 *  - Client coordinated dispatch email listing each independent entity's separate doc link
 */
import { Resend } from "resend";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fromAddress(): string {
  const addr =
    process.env.RESEND_FROM_COBID ||
    process.env.RESEND_FROM_ACCOUNTS ||
    process.env.RESEND_FROM_EMAIL ||
    "onboarding@resend.dev";
  return `Hazmat Management Co-Bid <${addr}>`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }
  const resend = new Resend(apiKey);
  try {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to,
      subject,
      html,
    });
    if (error) {
      return { sent: false, error: `${error.name ?? "Resend"}: ${error.message}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : "Email send failed" };
  }
}

export async function sendCobidInviteEmail(params: {
  to: string;
  recipientName: string;
  roleType: "coordinator" | "contractor" | "client";
  workspaceRef: string;
  propertyAddress: string;
  opCoName?: string | null;
  inviteUrl: string;
}): Promise<{ sent: boolean; error?: string }> {
  const roleLabel =
    params.roleType === "contractor"
      ? params.opCoName
        ? `Independent Operator (${params.opCoName})`
        : "Independent Operator"
      : params.roleType === "client"
        ? "Client"
        : "Coordinator";

  const subject = `Workspace Invite: ${params.workspaceRef} — ${params.propertyAddress}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #0f172a;">
      <div style="border-top: 4px solid #0f172a; padding-top: 22px; margin-bottom: 24px;">
        <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b; margin-bottom: 6px;">
          Hazmat Management · Co-Bid Workspace
        </div>
        <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0;">
          You&rsquo;ve been invited to ${esc(params.workspaceRef)}
        </h1>
      </div>

      <p style="font-size: 14px; line-height: 1.6; color: #334155;">Hi ${esc(params.recipientName)},</p>
      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        You have been invited as <strong>${esc(roleLabel)}</strong> to the Co-Bid Remediation Workspace for:
      </p>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 18px; margin: 18px 0;">
        <div style="font-size: 12px; font-family: monospace; color: #64748b;">${esc(params.workspaceRef)}</div>
        <div style="font-size: 15px; font-weight: 600; color: #0f172a; margin-top: 4px;">${esc(params.propertyAddress)}</div>
      </div>

      <p style="margin: 24px 0;">
        <a href="${esc(params.inviteUrl)}" style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 8px;">
          Open Secure Workspace &rarr;
        </a>
      </p>

      <p style="font-size: 12px; line-height: 1.6; color: #64748b;">
        This link is role-locked and expires in 7 days. Commercial scopes, agreements, and invoices remain strictly ring-fenced per independent Operating Company.
      </p>
    </div>
  `;
  return sendEmail(params.to, subject, html);
}

export async function sendCobidOnboardingEmail(params: {
  to: string;
  contactName: string;
  companyName: string;
  tradeCategory: string;
  onboardingUrl: string;
}): Promise<{ sent: boolean; error?: string }> {
  const subject = `Operator Onboarding Required: ${params.companyName} — Hazmat Management Co-Bid`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; color: #0f172a;">
      <div style="border-top: 4px solid #0f172a; padding-top: 22px; margin-bottom: 24px;">
        <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b; margin-bottom: 6px;">
          Hazmat Management · Independent Operator Onboarding
        </div>
        <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0;">
          Complete your operator profile for ${esc(params.companyName)}
        </h1>
      </div>

      <p style="font-size: 14px; line-height: 1.6; color: #334155;">Hi ${esc(params.contactName || params.companyName)},</p>
      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        Before you can receive independent co-bid job invitations for <strong>${esc(params.tradeCategory)}</strong>, please complete your company onboarding profile:
      </p>
      <ul style="font-size: 13px; line-height: 1.7; color: #334155; padding-left: 20px;">
        <li>Entity details, ABN/ACN, GST registration, logo, and your own Terms &amp; Conditions</li>
        <li>Current insurances &amp; trade licences (Public Liability, WorkCover, relevant licences with expiry dates)</li>
        <li>Connect your Xero account (recommended for direct automated invoicing) or provide direct bank details</li>
        <li>Sign the Independent Operator Platform Deed (confirming independent entity status — not a partnership or subcontracting)</li>
      </ul>

      <p style="margin: 24px 0;">
        <a href="${esc(params.onboardingUrl)}" style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 8px;">
          Start Operator Onboarding &rarr;
        </a>
      </p>

      <p style="font-size: 12px; line-height: 1.6; color: #64748b;">
        This onboarding link expires in 14 days. Once submitted, our team will verify your compliance documents and approve your profile.
      </p>
    </div>
  `;
  return sendEmail(params.to, subject, html);
}

export async function sendCobidBidInviteEmail(params: {
  to: string;
  contactName: string;
  companyName: string;
  quoteTypeLabel: string;
  workspaceRef: string;
  propertyAddress: string;
  stageOrder: number;
  bidUrl: string;
}): Promise<{ sent: boolean; error?: string }> {
  const subject = `Quote Invite (${params.quoteTypeLabel}): ${params.propertyAddress}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; color: #0f172a;">
      <div style="border-top: 4px solid #0f172a; padding-top: 22px; margin-bottom: 24px;">
        <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b; margin-bottom: 6px;">
          Stage ${params.stageOrder} · ${esc(params.quoteTypeLabel)}
        </div>
        <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0;">
          Build &amp; Approve Your Independent Quote
        </h1>
      </div>

      <p style="font-size: 14px; line-height: 1.6; color: #334155;">Hi ${esc(params.contactName || params.companyName)},</p>
      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        <strong>${esc(params.companyName)}</strong> has been invited as an independent operator for Stage ${params.stageOrder} on:
      </p>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 18px; margin: 18px 0;">
        <div style="font-size: 12px; font-family: monospace; color: #64748b;">Ref: ${esc(params.workspaceRef)} · ${esc(params.quoteTypeLabel)}</div>
        <div style="font-size: 15px; font-weight: 600; color: #0f172a; margin-top: 4px;">${esc(params.propertyAddress)}</div>
      </div>

      <p style="font-size: 13px; line-height: 1.6; color: #334155;">
        Use your private quote builder link below to review shared site details/photos, build your independent scope and pricing, and lock your quote for dispatch to the client.
      </p>

      <p style="margin: 24px 0;">
        <a href="${esc(params.bidUrl)}" style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 8px;">
          Open ${esc(params.quoteTypeLabel)} Builder &rarr;
        </a>
      </p>

      <p style="font-size: 12px; line-height: 1.6; color: #64748b;">
        Your pricing and quote are strictly ring-fenced from all other operators. When dispatched, the client will sign your company&rsquo;s own agreement and pay your company directly.
      </p>
    </div>
  `;
  return sendEmail(params.to, subject, html);
}

export async function sendCobidPackageEmail(params: {
  to: string;
  clientName: string;
  propertyAddress: string;
  packageUrl: string;
  documents: {
    stageOrder: number;
    companyName: string;
    abn: string;
    tradeCategory: string;
    independentJobRef: string;
    totalIncGstLabel: string;
    docUrl: string;
  }[];
}): Promise<{ sent: boolean; error?: string }> {
  const subject = `Independent Remediation Quotes Ready (${params.documents.length} Separate Companies) — ${params.propertyAddress}`;
  const cardsHtml = params.documents
    .map(
      (d) => `
        <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 16px 18px; margin-bottom: 12px;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #475569;">
            Stage ${d.stageOrder} · ${esc(d.tradeCategory)} · Job ${esc(d.independentJobRef)}
          </div>
          <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-top: 4px;">
            ${esc(d.companyName)}
          </div>
          <div style="font-size: 12px; color: #64748b; margin-top: 2px;">
            ABN ${esc(d.abn || "On document")} · Separate Quote &amp; Agreement · ${esc(d.totalIncGstLabel)} (inc GST)
          </div>
          <div style="margin-top: 12px;">
            <a href="${esc(d.docUrl)}" style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 13px; padding: 9px 16px; border-radius: 7px;">
              Review &amp; Sign ${esc(d.companyName)} Quote &rarr;
            </a>
          </div>
        </div>
      `
    )
    .join("");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; color: #0f172a;">
      <div style="border-top: 4px solid #0f172a; padding-top: 22px; margin-bottom: 20px;">
        <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b; margin-bottom: 6px;">
          Coordinated Multi-Company Remediation Quotes
        </div>
        <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0;">
          ${params.documents.length} Separate Company Quotes for ${esc(params.propertyAddress)}
        </h1>
      </div>

      <p style="font-size: 14px; line-height: 1.6; color: #334155;">Hi ${esc(params.clientName)},</p>
      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        Your sequenced remediation works require <strong>${params.documents.length} separate, independent specialist companies</strong>.
        This is <strong>not</strong> a partnership or subcontracting arrangement — each company below has its own separate job, scope, quote, legal agreement, and direct invoice.
      </p>

      <div style="margin: 20px 0;">
        ${cardsHtml}
      </div>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-top: 20px;">
        <div style="font-size: 12px; font-weight: 600; color: #0f172a;">Want to track all ${params.documents.length} separate links in one place?</div>
        <p style="font-size: 12px; color: #475569; margin: 6px 0 10px;">
          You can also open the neutral dispatch index to view the status of each company&rsquo;s separate quote and link:
        </p>
        <a href="${esc(params.packageUrl)}" style="font-size: 13px; font-weight: 600; color: #0f172a;">
          Open Coordinated Index &rarr;
        </a>
      </div>
    </div>
  `;
  return sendEmail(params.to, subject, html);
}
