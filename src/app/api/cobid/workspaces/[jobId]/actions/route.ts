import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { clientIpFromRequest, userAgentFromRequest } from "@/lib/portalAuth";
import { resolveCobidSession, sessionToUserRole } from "@/lib/cobid/session";
import { addCobidAuditEvent, getWorkspaceById } from "@/lib/cobid/store";
import { nowAuLabel, todayAuLabel } from "@/lib/cobid/utils";
import type { UserRole } from "@/lib/cobid/types";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const session = await resolveCobidSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await context.params;
    if (session.jobId && session.jobId !== jobId) {
      return NextResponse.json({ error: "Forbidden for this workspace" }, { status: 403 });
    }

    const body = await req.json();
    const { action, role: previewRole, payload } = body as {
      action: string;
      role?: UserRole;
      payload: Record<string, unknown>;
    };

    // Magic-link sessions are strictly locked to their invited role.
    // Staff coordinators may dispatch actions under a preview role when testing/demoing.
    const role: UserRole =
      session.source === "magic_link"
        ? sessionToUserRole(session)
        : previewRole ?? { type: "coordinator" };

    const job = await getWorkspaceById(session.orgId, jobId);
    if (!job) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const opCoId = typeof payload?.opCoId === "string" ? payload.opCoId : undefined;

    // Enforce commercial ring-fencing for contractor sessions
    if (role.type === "contractor" && opCoId && opCoId !== role.opCoId) {
      return NextResponse.json(
        { error: "Forbidden: cannot act on another OpCo scope" },
        { status: 403 }
      );
    }

    const targetOpCo = opCoId ? job.opCos.find((o) => o.id === opCoId) : undefined;
    const supabase = createServiceClient();

    const audit = (
      actor: string,
      category: "workspace" | "scope" | "legal" | "settlement" | "operations" | "variation",
      summary: string,
      restrictedToScopeId?: string
    ) =>
      addCobidAuditEvent({
        orgId: session.orgId,
        workspaceId: jobId,
        actor,
        category,
        summary,
        restrictedToScopeId: restrictedToScopeId ?? null,
      });

    switch (action) {
      case "set_settlement_rail": {
        if (role.type !== "coordinator") {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const rail = payload.rail === "trust_clearing" ? "trust_clearing" : "direct_to_opco";
        await supabase
          .from("cobid_workspaces")
          .update({ settlement_rail: rail, updated_at: new Date().toISOString() })
          .eq("id", jobId)
          .eq("org_id", session.orgId);
        await audit(
          job.coordinatorName,
          "settlement",
          `Switched workspace settlement rail to ${
            rail === "direct_to_opco" ? "Direct-to-OpCo" : "Statutory Trust Clearing → OpCos"
          }.`
        );
        break;
      }

      case "add_line_item": {
        if (role.type !== "coordinator" || !targetOpCo) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const item = payload.item as {
          code: string;
          description: string;
          unit: string;
          qty: number;
          unitPrice: number;
          category: string;
        };
        await supabase.from("cobid_line_items").insert({
          scope_id: targetOpCo.id,
          org_id: session.orgId,
          code: item.code,
          description: item.description,
          unit: item.unit,
          qty: Number(item.qty) || 1,
          unit_price: Number(item.unitPrice) || 0,
          category: item.category || "Scoping Addition",
          sort_order: targetOpCo.lineItems.length,
        });
        if (targetOpCo.scopeStatus === "contractor_approved") {
          await supabase
            .from("cobid_scopes")
            .update({ scope_status: "draft" })
            .eq("id", targetOpCo.id)
            .eq("org_id", session.orgId);
        }
        await audit(
          job.coordinatorName,
          "scope",
          `Added estimate line item "${item.description}" to ${targetOpCo.companyName}.`,
          targetOpCo.id
        );
        break;
      }

      case "remove_line_item": {
        if (role.type !== "coordinator" || !targetOpCo) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const lineItemId = String(payload.lineItemId || "");
        if (lineItemId) {
          await supabase
            .from("cobid_line_items")
            .delete()
            .eq("id", lineItemId)
            .eq("scope_id", targetOpCo.id)
            .eq("org_id", session.orgId);
        }
        break;
      }

      case "send_scope_to_contractor": {
        if (role.type !== "coordinator" || !targetOpCo) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        await supabase
          .from("cobid_scopes")
          .update({ scope_status: "pending_contractor", revision_note: null })
          .eq("id", targetOpCo.id)
          .eq("org_id", session.orgId);
        await audit(
          job.coordinatorName,
          "scope",
          `Submitted drafted Scope & Estimate to ${targetOpCo.companyName} for OpCo approval.`,
          targetOpCo.id
        );
        break;
      }

      case "approve_scope": {
        if (role.type === "client" || !targetOpCo) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        await supabase
          .from("cobid_scopes")
          .update({
            scope_status: "contractor_approved",
            contractor_approved_at: nowAuLabel(),
            revision_note: null,
            agreement_status:
              targetOpCo.agreementStatus === "not_ready"
                ? "ready_to_send"
                : targetOpCo.agreementStatus,
          })
          .eq("id", targetOpCo.id)
          .eq("org_id", session.orgId);
        await audit(
          `${targetOpCo.contactName} (${targetOpCo.companyName})`,
          "scope",
          `Approved independent Scope & Estimate for ${targetOpCo.tradeCategory}.`,
          targetOpCo.id
        );
        break;
      }

      case "request_revision": {
        if (role.type === "client" || !targetOpCo) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const note = String(payload.note || "");
        await supabase
          .from("cobid_scopes")
          .update({ scope_status: "revision_requested", revision_note: note })
          .eq("id", targetOpCo.id)
          .eq("org_id", session.orgId);
        await audit(
          `${targetOpCo.contactName} (${targetOpCo.companyName})`,
          "scope",
          `Requested scope/estimate revision: "${note}".`,
          targetOpCo.id
        );
        break;
      }

      case "send_agreement": {
        if (role.type !== "coordinator" || !targetOpCo) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        await supabase
          .from("cobid_scopes")
          .update({ agreement_status: "sent_to_client", agreement_sent_at: nowAuLabel() })
          .eq("id", targetOpCo.id)
          .eq("org_id", session.orgId);
        await audit(
          job.coordinatorName,
          "legal",
          `Issued Independent Agreement ${targetOpCo.agreementRef} (${targetOpCo.companyName}) to Client.`,
          targetOpCo.id
        );
        break;
      }

      case "sign_agreement": {
        if (role.type === "contractor" || !targetOpCo) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const signerName = String(payload.signerName || job.clientName).trim();
        const ip = clientIpFromRequest(req);
        const ua = userAgentFromRequest(req);
        const hash = `SHA256:${crypto
          .createHash("sha256")
          .update(`${targetOpCo.agreementRef}:${signerName}:${ip}:${Date.now()}`)
          .digest("hex")
          .slice(0, 12)}`;
        await supabase
          .from("cobid_scopes")
          .update({
            agreement_status: "signed",
            client_signed_at: nowAuLabel(),
            client_signed_by: signerName,
            agreement_audit_hash: hash,
            client_signed_ip: ip,
            client_signed_user_agent: ua,
          })
          .eq("id", targetOpCo.id)
          .eq("org_id", session.orgId);
        await audit(
          `${signerName} (Client)`,
          "legal",
          `Executed Independent Agreement ${targetOpCo.agreementRef} directly with ${targetOpCo.companyName} (${hash}).`,
          targetOpCo.id
        );
        break;
      }

      case "pay_deposit": {
        if (role.type === "contractor" || !targetOpCo) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const method = String(payload.method || "Bank Transfer / PayID");
        const ref =
          typeof payload.paymentRef === "string" && payload.paymentRef.trim()
            ? payload.paymentRef.trim()
            : `PAY-${Math.floor(100000 + Math.random() * 900000)}`;
        await supabase
          .from("cobid_scopes")
          .update({
            deposit_status: "paid",
            deposit_paid_at: nowAuLabel(),
            deposit_payment_ref: ref,
            deposit_method: method,
          })
          .eq("id", targetOpCo.id)
          .eq("org_id", session.orgId);
        await audit(
          `${job.clientName} (Client)`,
          "settlement",
          `Settled individual deposit directly to ${targetOpCo.companyName} via ${method} (Ref ${ref}).`,
          targetOpCo.id
        );
        break;
      }

      case "pay_balance": {
        if (role.type === "contractor" || !targetOpCo) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const ref =
          typeof payload.paymentRef === "string" && payload.paymentRef.trim()
            ? payload.paymentRef.trim()
            : `BAL-${Math.floor(100000 + Math.random() * 900000)}`;
        await supabase
          .from("cobid_scopes")
          .update({
            balance_status: "paid",
            balance_paid_at: nowAuLabel(),
            balance_payment_ref: ref,
          })
          .eq("id", targetOpCo.id)
          .eq("org_id", session.orgId);
        await audit(
          `${job.clientName} (Client)`,
          "settlement",
          `Settled Final Balance Tax Invoice ${targetOpCo.balanceInvoiceRef} directly to ${targetOpCo.companyName} (Ref ${ref}).`,
          targetOpCo.id
        );
        break;
      }

      case "create_variation": {
        if (role.type === "client" || !targetOpCo) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const title = String(payload.title || "");
        const reason = String(payload.reason || "");
        const amountExGst = Number(payload.amountExGst) || 0;
        const count = targetOpCo.variations.length + 1;
        const ref = `VAR-${job.reference.slice(-4)}-${targetOpCo.monogram}0${count}`;
        const actor =
          role.type === "coordinator"
            ? job.coordinatorName
            : `${targetOpCo.contactName} (${targetOpCo.companyName})`;

        await supabase.from("cobid_variations").insert({
          scope_id: targetOpCo.id,
          org_id: session.orgId,
          reference: ref,
          title,
          reason,
          amount_ex_gst: amountExGst,
          status: role.type === "coordinator" ? "sent_to_client" : "pending_coordinator",
          created_at_label: nowAuLabel(),
          created_by: actor,
        });
        await audit(
          actor,
          "variation",
          `Raised Variation ${ref} ("${title}", $${amountExGst.toFixed(2)} ex GST) under ${targetOpCo.companyName}.`,
          targetOpCo.id
        );
        break;
      }

      case "issue_variation": {
        if (role.type !== "coordinator" || !targetOpCo) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const variationId = String(payload.variationId || "");
        const v = targetOpCo.variations.find((item) => item.id === variationId);
        if (v) {
          await supabase
            .from("cobid_variations")
            .update({ status: "sent_to_client" })
            .eq("id", variationId)
            .eq("scope_id", targetOpCo.id)
            .eq("org_id", session.orgId);
          await audit(
            job.coordinatorName,
            "variation",
            `Verified and issued Variation Addendum ${v.reference} (${targetOpCo.companyName}) to Client.`,
            targetOpCo.id
          );
        }
        break;
      }

      case "respond_variation": {
        if (role.type === "contractor" || !targetOpCo) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const variationId = String(payload.variationId || "");
        const approve = Boolean(payload.approve);
        const v = targetOpCo.variations.find((item) => item.id === variationId);
        if (v) {
          await supabase
            .from("cobid_variations")
            .update({
              status: approve ? "approved" : "declined",
              approved_at: nowAuLabel(),
              approved_by: job.clientName,
            })
            .eq("id", variationId)
            .eq("scope_id", targetOpCo.id)
            .eq("org_id", session.orgId);
          await audit(
            `${job.clientName} (Client)`,
            "variation",
            `${approve ? "Approved & signed" : "Declined"} Variation Addendum ${v.reference} for ${targetOpCo.companyName}.`,
            targetOpCo.id
          );
        }
        break;
      }

      case "update_milestone": {
        if (role.type === "client" || !targetOpCo) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const milestoneId = String(payload.milestoneId || "");
        const status = String(payload.status || "pending");
        const milestone = targetOpCo.milestones.find((m) => m.id === milestoneId);
        if (milestone) {
          await supabase
            .from("cobid_milestones")
            .update({
              status,
              completed_at: status === "completed" ? nowAuLabel() : null,
            })
            .eq("id", milestoneId)
            .eq("scope_id", targetOpCo.id)
            .eq("org_id", session.orgId);

          const actor =
            role.type === "coordinator"
              ? job.coordinatorName
              : `${targetOpCo.contactName} (${targetOpCo.companyName})`;

          await audit(
            actor,
            "operations",
            `Marked "${milestone.title}" as ${status.replace("_", " ")} (${targetOpCo.companyName}).`
          );

          // Auto-unlock downstream OpCo when the handover gate clears
          if (milestone.isHandoverGate && status === "completed") {
            const downstreamOpCos = job.opCos.filter(
              (o) => o.dependsOnOpCoId === targetOpCo.id
            );
            for (const down of downstreamOpCos) {
              const lockedCount = down.milestones.filter((m) => m.status === "locked").length;
              if (lockedCount > 0) {
                await supabase
                  .from("cobid_milestones")
                  .update({ status: "pending" })
                  .eq("scope_id", down.id)
                  .eq("org_id", session.orgId)
                  .eq("status", "locked");
                await audit(
                  "CoBid Sequencer",
                  "operations",
                  `Handover gate cleared by ${targetOpCo.companyName} — unlocked Stage ${down.sequenceOrder} (${down.companyName}).`
                );
              }
            }
          }
        }
        break;
      }

      case "add_progress_log": {
        if (role.type === "client" || !targetOpCo) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const author = String(payload.author || job.coordinatorName);
        const summary = String(payload.summary || "");
        const stage = String(payload.stage || "during");
        await supabase.from("cobid_progress_logs").insert({
          scope_id: targetOpCo.id,
          org_id: session.orgId,
          timestamp_label: nowAuLabel(),
          author,
          summary,
          stage,
          photo_label: payload.photoLabel ? String(payload.photoLabel) : null,
          photo_tone: payload.photoTone ? String(payload.photoTone) : null,
          photo_url: payload.photoUrl ? String(payload.photoUrl) : null,
        });
        await audit(author, "operations", `Posted ${stage} site progress update.`);
        break;
      }

      case "attach_compliance_doc": {
        if (role.type === "client" || !targetOpCo) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const docId = String(payload.docId || "");
        const fileUrl = String(payload.fileUrl || "");
        const reference = String(payload.reference || `DOC-${Date.now().toString().slice(-5)}`);
        if (docId && fileUrl) {
          const { data: doc } = await supabase
            .from("cobid_compliance_docs")
            .update({
              file_url: fileUrl,
              reference,
              issued_at: todayAuLabel(),
              status: "verified",
            })
            .eq("id", docId)
            .eq("scope_id", targetOpCo.id)
            .eq("org_id", session.orgId)
            .select("title")
            .single();

          await audit(
            role.type === "coordinator"
              ? job.coordinatorName
              : `${targetOpCo.contactName} (${targetOpCo.companyName})`,
            "operations",
            `Uploaded verified compliance certificate "${doc?.title ?? reference}" for ${targetOpCo.companyName}.`
          );
        }
        break;
      }

      case "sign_off_completion": {
        if (role.type === "client" || !targetOpCo) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const notes = String(payload.notes || "");
        const now = nowAuLabel();
        await supabase
          .from("cobid_scopes")
          .update({
            completion_signed_off: true,
            completion_signed_at: now,
            completion_notes: notes,
          })
          .eq("id", targetOpCo.id)
          .eq("org_id", session.orgId);

        await supabase
          .from("cobid_milestones")
          .update({ status: "completed", completed_at: now })
          .eq("scope_id", targetOpCo.id)
          .eq("org_id", session.orgId)
          .neq("status", "completed");

        const pendingDocs = targetOpCo.complianceDocs.filter((d) => d.status !== "verified");
        for (let i = 0; i < pendingDocs.length; i++) {
          await supabase
            .from("cobid_compliance_docs")
            .update({
              status: "verified",
              issued_at: todayAuLabel(),
              reference: `CERT-${targetOpCo.monogram}-${new Date().getFullYear()}0${i + 1}`,
            })
            .eq("id", pendingDocs[i].id)
            .eq("org_id", session.orgId);
        }

        const actor =
          role.type === "coordinator"
            ? job.coordinatorName
            : `${targetOpCo.contactName} (${targetOpCo.companyName})`;
        await audit(
          actor,
          "operations",
          `Certified Stage ${targetOpCo.sequenceOrder} (${targetOpCo.companyName}) complete & issued compliance certificates.`
        );
        break;
      }

      case "post_message": {
        const channel = String(payload.channel || "shared_ops");
        const msgBody = String(payload.body || "").trim();
        if (!msgBody) break;

        if (role.type === "contractor" && channel !== "shared_ops" && channel !== role.opCoId) {
          return NextResponse.json({ error: "Forbidden channel" }, { status: 403 });
        }

        let senderName = job.coordinatorName;
        let senderRoleLabel = "Scoping Desk";
        if (role.type === "client") {
          senderName = job.clientName;
          senderRoleLabel = "Client";
        } else if (role.type === "contractor") {
          const senderOpCo = job.opCos.find((o) => o.id === role.opCoId);
          senderName = senderOpCo?.contactName ?? "Contractor";
          senderRoleLabel = senderOpCo?.companyName ?? "OpCo";
        }

        await supabase.from("cobid_messages").insert({
          workspace_id: jobId,
          org_id: session.orgId,
          channel,
          timestamp_label: nowAuLabel(),
          sender_name: senderName,
          sender_role_label: senderRoleLabel,
          body: msgBody,
        });
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const updated = await getWorkspaceById(session.orgId, jobId, role, req);
    return NextResponse.json({ job: updated });
  } catch (err) {
    console.error("POST /api/cobid/workspaces/[jobId]/actions error:", err);
    return NextResponse.json({ error: "Failed to execute action" }, { status: 500 });
  }
}
