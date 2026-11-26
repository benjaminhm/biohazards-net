"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Mail,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";

interface InviteRow {
  id: string;
  token: string;
  email: string;
  recipientName: string;
  roleType: "coordinator" | "contractor" | "client";
  opCoId: string | null;
  status: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  inviteUrl: string;
}

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
}

export function InviteModal({ open, onClose }: InviteModalProps) {
  const { activeJob } = useWorkspace();
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    if (!activeJob) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/cobid/workspaces/${activeJob.id}/invites`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as { invites: InviteRow[] };
        setInvites(data.invites ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [activeJob]);

  useEffect(() => {
    if (open) {
      setStatusNote(null);
      loadInvites();
    }
  }, [open, loadInvites]);

  if (!open || !activeJob) return null;

  const generateInvite = async (params: {
    key: string;
    email: string;
    recipientName: string;
    roleType: "contractor" | "client";
    opCoId?: string;
  }) => {
    setCreating(params.key);
    setStatusNote(null);
    try {
      const res = await fetch(`/api/cobid/workspaces/${activeJob.id}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: params.email,
          recipientName: params.recipientName,
          roleType: params.roleType,
          opCoId: params.opCoId,
          sendEmail: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.emailSent) {
          setStatusNote(`Magic link generated and emailed to ${params.email}.`);
        } else {
          setStatusNote(
            `Magic link generated for ${params.email} (email not dispatched: ${data.emailError || "copy link below"}).`
          );
        }
        await loadInvites();
      }
    } finally {
      setCreating(null);
    }
  };

  const revokeInvite = async (inviteId: string) => {
    await fetch(
      `/api/cobid/workspaces/${activeJob.id}/invites?inviteId=${encodeURIComponent(inviteId)}`,
      { method: "DELETE" }
    );
    await loadInvites();
  };

  const copyLink = async (inv: InviteRow) => {
    try {
      await navigator.clipboard.writeText(inv.inviteUrl);
      setCopiedId(inv.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Magic-Link Workspace Invites · {activeJob.reference}
              </h2>
              <p className="text-[11px] text-slate-500">
                Issue role-locked, cryptographically signed magic links for each party.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 p-6 text-xs">
          {statusNote && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900">
              {statusNote}
            </div>
          )}

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              1-Click Issue & Email Magic Link
            </div>
            <div className="mt-2.5 space-y-2">
              <div className="flex flex-col justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-emerald-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                      Client
                    </span>
                    <span className="font-semibold text-slate-900">
                      {activeJob.clientName}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {activeJob.clientEmail || "No email set"} · Locked to Client Portal on{" "}
                    {activeJob.reference}
                  </div>
                </div>
                <button
                  disabled={creating === "client" || !activeJob.clientEmail}
                  onClick={() =>
                    generateInvite({
                      key: "client",
                      email: activeJob.clientEmail,
                      recipientName: activeJob.clientName,
                      roleType: "client",
                    })
                  }
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <Mail className="h-3.5 w-3.5" />
                  {creating === "client" ? "Sending…" : "Send Magic Link"}
                </button>
              </div>

              {activeJob.opCos.map((opCo) => (
                <div
                  key={opCo.id}
                  className="flex flex-col justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                        Stage {opCo.sequenceOrder} OpCo
                      </span>
                      <span className="font-semibold text-slate-900">
                        {opCo.contactName} — {opCo.companyName}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {opCo.contactEmail || "No email set"} · Server-side ring-fenced to{" "}
                      {opCo.monogram} only
                    </div>
                  </div>
                  <button
                    disabled={creating === opCo.id || !opCo.contactEmail}
                    onClick={() =>
                      generateInvite({
                        key: opCo.id,
                        email: opCo.contactEmail,
                        recipientName: `${opCo.contactName} (${opCo.companyName})`,
                        roleType: "contractor",
                        opCoId: opCo.id,
                      })
                    }
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {creating === opCo.id ? "Sending…" : "Send Magic Link"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Issued Magic Links ({invites.length})
              </div>
              <span className="text-[11px] text-slate-400">
                Tip: Open a link in an Incognito window to test locked OpCo/Client auth
              </span>
            </div>

            {loading ? (
              <div className="py-6 text-center text-slate-400">Loading invites…</div>
            ) : invites.length === 0 ? (
              <div className="mt-2 rounded-xl border border-dashed border-slate-200 py-6 text-center text-slate-400">
                No magic links issued for this workspace yet. Generate one above.
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                {invites.map((inv) => {
                  const isRevoked = inv.status === "revoked";
                  return (
                    <div
                      key={inv.id}
                      className={`rounded-xl border p-3 ${
                        isRevoked
                          ? "border-slate-200 bg-slate-50 opacity-60"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-900">
                              {inv.recipientName}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                                inv.status === "accepted"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : inv.status === "revoked"
                                    ? "bg-rose-50 text-rose-700"
                                    : "bg-amber-50 text-amber-800"
                              }`}
                            >
                              {inv.status}
                            </span>
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                            …/invite/{inv.token.slice(0, 14)}… · {inv.email}
                          </div>
                        </div>

                        {!isRevoked && (
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              onClick={() => copyLink(inv)}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                            >
                              {copiedId === inv.id ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-600" />
                                  Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" />
                                  Copy Link
                                </>
                              )}
                            </button>
                            <a
                              href={inv.inviteUrl}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Open
                            </a>
                            <button
                              onClick={() => revokeInvite(inv.id)}
                              className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              title="Revoke magic link"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span>
              Accepting a magic link sets a signed <code>HttpOnly</code> session cookie (
              <code>bh_cobid</code>) strictly enforced on every API and PDF route. Revoking a link
              invalidates its session immediately.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
