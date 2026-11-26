/*
 * lib/cobid/email.ts
 *
 * Transactional invite email for Co-Bid magic links via Resend.
 * Gracefully reports { sent: false, reason } if RESEND_API_KEY is unset.
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

export async function sendCobidInviteEmail(params: {
  to: string;
  recipientName: string;
  roleType: "coordinator" | "contractor" | "client";
  workspaceRef: string;
  propertyAddress: string;
  opCoName?: string | null;
  inviteUrl: string;
}): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(apiKey);
  const roleLabel =
    params.roleType === "contractor"
      ? params.opCoName
        ? `Independent OpCo (${params.opCoName})`
        : "Independent OpCo"
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

      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        Hi ${esc(params.recipientName)},
      </p>
      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        You have been invited as <strong>${esc(roleLabel)}</strong> to the Co-Bid Remediation Settlement Workspace for:
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
        This link is role-locked and expires in 7 days. Commercial scopes, agreements, and deposits remain ring-fenced per independent Operating Company.
      </p>

      <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8;">
        Hazmat Management · app.hazmatmanagement.com.au
      </div>
    </div>
  `;

  try {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to: params.to,
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
