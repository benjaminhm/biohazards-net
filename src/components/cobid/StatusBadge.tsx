"use client";

import { cn } from "@/lib/cobid/utils";
import type {
  AgreementStatus,
  Milestone,
  PaymentStatus,
  ScopeApprovalStatus,
} from "@/lib/cobid/types";

export function ScopeBadge({ status }: { status: ScopeApprovalStatus }) {
  const map: Record<ScopeApprovalStatus, { label: string; cls: string }> = {
    draft: {
      label: "Drafting (Scoping Desk)",
      cls: "bg-slate-100 text-slate-700 border-slate-200",
    },
    pending_contractor: {
      label: "Awaiting OpCo Approval",
      cls: "bg-amber-50 text-amber-800 border-amber-200",
    },
    revision_requested: {
      label: "Revision Requested",
      cls: "bg-rose-50 text-rose-700 border-rose-200",
    },
    contractor_approved: {
      label: "OpCo Approved",
      cls: "bg-emerald-50 text-emerald-800 border-emerald-200",
    },
  };
  const cfg = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        cfg.cls
      )}
    >
      {cfg.label}
    </span>
  );
}

export function AgreementBadge({ status }: { status: AgreementStatus }) {
  const map: Record<AgreementStatus, { label: string; cls: string }> = {
    not_ready: {
      label: "Pending Scope Approval",
      cls: "bg-slate-100 text-slate-500 border-slate-200",
    },
    ready_to_send: {
      label: "Ready to Issue",
      cls: "bg-blue-50 text-blue-700 border-blue-200",
    },
    sent_to_client: {
      label: "Sent for Client Signature",
      cls: "bg-amber-50 text-amber-800 border-amber-200",
    },
    signed: {
      label: "Signed (Executed)",
      cls: "bg-emerald-50 text-emerald-800 border-emerald-200",
    },
  };
  const cfg = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        cfg.cls
      )}
    >
      {cfg.label}
    </span>
  );
}

export function DepositBadge({ status }: { status: PaymentStatus }) {
  return status === "paid" ? (
    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
      Deposit Settled
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
      Deposit Unpaid
    </span>
  );
}

export function MilestoneBadge({ status }: { status: Milestone["status"] }) {
  const map: Record<Milestone["status"], { label: string; cls: string }> = {
    locked: {
      label: "Awaiting Upstream Handover",
      cls: "bg-slate-100 text-slate-500 border-slate-200",
    },
    pending: {
      label: "Scheduled",
      cls: "bg-slate-100 text-slate-700 border-slate-200",
    },
    in_progress: {
      label: "In Progress",
      cls: "bg-blue-50 text-blue-700 border-blue-200",
    },
    completed: {
      label: "Completed",
      cls: "bg-emerald-50 text-emerald-800 border-emerald-200",
    },
  };
  const cfg = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        cfg.cls
      )}
    >
      {cfg.label}
    </span>
  );
}
