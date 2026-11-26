"use client";

import { useState } from "react";
import {
  History,
  Lock,
  MessageSquare,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";

export function ActivityAuditTab() {
  const { activeJob, role, postMessage } = useWorkspace();
  const [activeChannel, setActiveChannel] = useState<string>("shared_ops");
  const [draftMsg, setDraftMsg] = useState("");

  if (!activeJob) return null;

  const availableChannels = [
    {
      id: "shared_ops",
      label: "Shared Site Operations",
      subtitle: "All parties · Access, sequencing & handover",
      isPrivate: false,
    },
    ...activeJob.opCos
      .filter((o) => role.type !== "contractor" || role.opCoId === o.id)
      .map((o) => ({
        id: o.id,
        label: `Private: ${o.companyName}`,
        subtitle: "Ring-fenced · Coordinator, Client & OpCo only",
        isPrivate: true,
      })),
  ];

  const effectiveChannel = availableChannels.some((c) => c.id === activeChannel)
    ? activeChannel
    : "shared_ops";

  const visibleMessages = activeJob.messages.filter(
    (m) => m.channel === effectiveChannel
  );

  const visibleAuditEvents = activeJob.auditLog.filter((evt) => {
    if (!evt.restrictedToOpCoId) return true;
    if (role.type !== "contractor") return true;
    return role.opCoId === evt.restrictedToOpCoId;
  });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftMsg.trim()) return;
    postMessage(effectiveChannel, draftMsg);
    setDraftMsg("");
  };

  const categoryColor: Record<string, string> = {
    workspace: "bg-slate-100 text-slate-700",
    scope: "bg-blue-50 text-blue-700",
    legal: "bg-indigo-50 text-indigo-700",
    settlement: "bg-emerald-50 text-emerald-800",
    operations: "bg-amber-50 text-amber-800",
    variation: "bg-purple-50 text-purple-800",
  };

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs lg:col-span-7">
        <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              Workspace Messaging (Ring-Fenced Channels)
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Operational coordination happens in the shared room; commercial quotes & contract
            questions stay private per OpCo.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {availableChannels.map((ch) => {
              const active = effectiveChannel === ch.id;
              return (
                <button
                  key={ch.id}
                  onClick={() => setActiveChannel(ch.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {ch.isPrivate ? (
                    <Lock className="h-3 w-3" />
                  ) : (
                    <Users className="h-3 w-3" />
                  )}
                  {ch.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          className="flex-1 space-y-3 p-5"
          style={{ minHeight: "320px", maxHeight: "460px", overflowY: "auto" }}
        >
          {visibleMessages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-xs text-slate-400">
              No messages in this channel yet. Start the conversation below.
            </div>
          ) : (
            visibleMessages.map((msg) => (
              <div
                key={msg.id}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">
                      {msg.senderName}
                    </span>
                    <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">
                      {msg.senderRoleLabel}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">{msg.timestamp}</span>
                </div>
                <p className="mt-2 leading-relaxed text-slate-700">{msg.body}</p>
              </div>
            ))
          )}
        </div>

        <form
          onSubmit={handleSend}
          className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 p-3.5"
        >
          <input
            type="text"
            value={draftMsg}
            onChange={(e) => setDraftMsg(e.target.value)}
            placeholder={
              effectiveChannel === "shared_ops"
                ? "Post a shared site/handover update..."
                : "Send a private commercial message in this OpCo thread..."
            }
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draftMsg.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
            Send
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs lg:col-span-5">
        <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-slate-700" />
              <h2 className="text-sm font-semibold text-slate-900">
                Settlement Audit Ledger
              </h2>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              <ShieldCheck className="h-3 w-3" />
              Tamper-Evident
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Chronological record of approvals, individual agreements, settlements, variations &
            handover gates.
          </p>
        </div>

        <div
          className="divide-y divide-slate-100 p-4"
          style={{ maxHeight: "520px", overflowY: "auto" }}
        >
          {visibleAuditEvents.map((evt) => (
            <div key={evt.id} className="py-3 first:pt-1 last:pb-1">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                    categoryColor[evt.category] ?? "bg-slate-100 text-slate-700"
                  }`}
                >
                  {evt.category}
                </span>
                <span className="text-[11px] text-slate-400">{evt.timestamp}</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-800">
                {evt.summary}
              </p>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                <span>Actor: {evt.actor}</span>
                {evt.restrictedToOpCoId && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400">
                    · <Lock className="h-2.5 w-2.5" /> Ring-fenced
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
