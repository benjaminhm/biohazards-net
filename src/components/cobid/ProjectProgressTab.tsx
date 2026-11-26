"use client";

import { useState } from "react";
import {
  Camera,
  CheckCircle2,
  Clock,
  FilePlus2,
  Lock,
  PlayCircle,
  Plus,
  Send,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import {
  formatAUD,
  getOpCoProgressPercent,
  isUpstreamHandoverComplete,
} from "@/lib/cobid/utils";
import { MilestoneBadge } from "./StatusBadge";

export function ProjectProgressTab() {
  const {
    activeJob,
    role,
    updateMilestoneStatus,
    addProgressLog,
    createVariation,
    issueVariationToClient,
    respondVariationAsClient,
  } = useWorkspace();

  const [logOpCoId, setLogOpCoId] = useState<string | null>(null);
  const [logSummary, setLogSummary] = useState("");
  const [logStage, setLogStage] = useState<"before" | "during" | "after" | "compliance">("during");
  const [logPhotoLabel, setLogPhotoLabel] = useState("");
  const [logPhotoUrl, setLogPhotoUrl] = useState<string | undefined>(undefined);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [varOpCoId, setVarOpCoId] = useState<string | null>(null);
  const [varTitle, setVarTitle] = useState("");
  const [varReason, setVarReason] = useState("");
  const [varAmount, setVarAmount] = useState("450");

  if (!activeJob) return null;

  const handlePhotoUpload = async (file: File) => {
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/cobid/uploads", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const data = (await res.json()) as { url: string; filename: string };
      setLogPhotoUrl(data.url);
      if (!logPhotoLabel.trim()) setLogPhotoLabel(data.filename);
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleAddLog = async (opCoId: string, author: string) => {
    if (!logSummary.trim()) return;
    await addProgressLog(opCoId, {
      author,
      summary: logSummary.trim(),
      stage: logStage,
      photoLabel: logPhotoLabel.trim() || undefined,
      photoUrl: logPhotoUrl,
      photoTone:
        logStage === "after"
          ? "from-emerald-700 to-teal-900"
          : logStage === "compliance"
            ? "from-indigo-700 to-slate-900"
            : "from-slate-700 to-slate-900",
    });
    setLogSummary("");
    setLogPhotoLabel("");
    setLogPhotoUrl(undefined);
    setLogOpCoId(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">
          Sequenced Project Management & Site Progress
        </h2>
        <p className="text-xs text-slate-500">
          Shared operational timeline with automatic cross-OpCo handover gates. Downstream trades unlock as soon as the upstream contractor certifies site handover.
        </p>
      </div>

      <div className="space-y-5">
        {activeJob.opCos.map((opCo) => {
          const isOwnOpCo = role.type !== "contractor" || role.opCoId === opCo.id;
          const canManage =
            role.type === "coordinator" ||
            (role.type === "contractor" && role.opCoId === opCo.id);
          const upstreamReady = isUpstreamHandoverComplete(opCo, activeJob.opCos);
          const progress = getOpCoProgressPercent(opCo);
          const contractReady =
            opCo.agreementStatus === "signed" && opCo.depositStatus === "paid";

          return (
            <div
              key={opCo.id}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs"
            >
              <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800">
                    {opCo.monogram}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                        Stage {opCo.sequenceOrder}
                      </span>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {opCo.companyName}
                      </h3>
                    </div>
                    <div className="text-xs text-slate-500">{opCo.tradeCategory}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-xs font-semibold text-slate-900">
                      {progress}% Complete
                    </div>
                    <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-emerald-600 transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {!contractReady && isOwnOpCo && (
                <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-xs text-amber-800">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  <span>
                    Pre-mobilisation notice: Individual agreement signature & deposit settlement are
                    recommended prior to commencing site works.
                  </span>
                </div>
              )}

              {!upstreamReady && (
                <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-5 py-2.5 text-xs text-slate-600">
                  <Lock className="h-4 w-4 shrink-0" />
                  <span>
                    Stage {opCo.sequenceOrder} is sequenced after Stage {opCo.sequenceOrder - 1}.
                    Completing the upstream <strong>Clearance Handover Gate</strong> automatically
                    unlocks these milestones.
                  </span>
                </div>
              )}

              <div className="divide-y divide-slate-100 px-5">
                {opCo.milestones.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {m.status === "completed" ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        ) : m.status === "in_progress" ? (
                          <PlayCircle className="h-5 w-5 text-blue-600" />
                        ) : m.status === "locked" ? (
                          <Lock className="h-5 w-5 text-slate-300" />
                        ) : (
                          <Clock className="h-5 w-5 text-slate-400" />
                        )}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-slate-900">
                            {m.title}
                          </span>
                          {m.isHandoverGate && (
                            <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-indigo-700">
                              Handover Gate
                            </span>
                          )}
                          <span className="text-[11px] text-slate-400">
                            Target: {m.targetDay}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-600">{m.description}</p>
                        {m.completedAt && (
                          <div className="mt-1 text-[11px] text-emerald-700">
                            Completed {m.completedAt}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <MilestoneBadge status={m.status} />
                      {canManage && m.status !== "locked" && m.status !== "completed" && (
                        <div className="flex gap-1.5">
                          {m.status === "pending" && (
                            <button
                              onClick={() =>
                                updateMilestoneStatus(opCo.id, m.id, "in_progress")
                              }
                              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Start
                            </button>
                          )}
                          <button
                            onClick={() =>
                              updateMilestoneStatus(opCo.id, m.id, "completed")
                            }
                            className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800"
                          >
                            Mark Complete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-200 bg-slate-50/50 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Site Logs & Photo Evidence ({opCo.progressLogs.length})
                  </h4>
                  {canManage && (
                    <button
                      onClick={() =>
                        setLogOpCoId(logOpCoId === opCo.id ? null : opCo.id)
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Progress Update
                    </button>
                  )}
                </div>

                {logOpCoId === opCo.id && (
                  <div className="mb-4 space-y-2.5 rounded-lg border border-slate-200 bg-white p-3.5">
                    <textarea
                      rows={2}
                      placeholder="Log daily site progress, volumes cleared, moisture/ATP readings, or handover notes..."
                      value={logSummary}
                      onChange={(e) => setLogSummary(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={logStage}
                        onChange={(e) =>
                          setLogStage(
                            e.target.value as "before" | "during" | "after" | "compliance"
                          )
                        }
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                      >
                        <option value="before">Before</option>
                        <option value="during">During Works</option>
                        <option value="after">After / Handover</option>
                        <option value="compliance">Compliance / Verification</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Photo pack caption (optional)..."
                        value={logPhotoLabel}
                        onChange={(e) => setLogPhotoLabel(e.target.value)}
                        className="flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                      />
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
                        <Camera className="h-3.5 w-3.5" />
                        {uploadingPhoto
                          ? "Uploading…"
                          : logPhotoUrl
                            ? "Photo Attached ✓"
                            : "Upload Photo"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handlePhotoUpload(f);
                          }}
                        />
                      </label>
                      <button
                        disabled={uploadingPhoto}
                        onClick={() =>
                          handleAddLog(
                            opCo.id,
                            role.type === "coordinator"
                              ? activeJob.coordinatorName
                              : `${opCo.contactName} (${opCo.companyName})`
                          )
                        }
                        className="rounded-md bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        Post Log
                      </button>
                    </div>
                  </div>
                )}

                {opCo.progressLogs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-white py-5 text-center text-xs text-slate-400">
                    No site progress logs posted for {opCo.companyName} yet.
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {opCo.progressLogs.map((log) => (
                      <div
                        key={log.id}
                        className="rounded-lg border border-slate-200 bg-white p-3.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-800">
                            {log.author}
                          </span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600">
                            {log.stage}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          {log.timestamp}
                        </div>
                        <p className="mt-2 leading-relaxed text-slate-600">
                          {log.summary}
                        </p>
                        {log.photoUrl ? (
                          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={log.photoUrl}
                              alt={log.photoLabel || "Site progress photo"}
                              className="h-36 w-full object-cover"
                            />
                            {log.photoLabel && (
                              <div className="bg-slate-50 px-2.5 py-1.5 text-[11px] font-medium text-slate-700">
                                {log.photoLabel}
                              </div>
                            )}
                          </div>
                        ) : (
                          log.photoLabel && (
                            <div
                              className={`mt-3 flex items-center gap-2 rounded-md bg-gradient-to-r px-3 py-2.5 text-white ${
                                log.photoTone ?? "from-slate-700 to-slate-900"
                              }`}
                            >
                              <Camera className="h-4 w-4 shrink-0 opacity-80" />
                              <span className="truncate text-[11px] font-medium">
                                {log.photoLabel}
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {isOwnOpCo && (
                <div className="border-t border-slate-200 bg-white p-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Scope Variations / Change Orders ({opCo.variations.length})
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        Approved variations amend {opCo.companyName}&apos;s individual contract &
                        final Tax Invoice only.
                      </p>
                    </div>
                    {canManage && (
                      <button
                        onClick={() =>
                          setVarOpCoId(varOpCoId === opCo.id ? null : opCo.id)
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <FilePlus2 className="h-3.5 w-3.5" />
                        Raise Variation
                      </button>
                    )}
                  </div>

                  {varOpCoId === opCo.id && (
                    <div className="mb-4 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3.5 sm:grid-cols-12">
                      <input
                        type="text"
                        placeholder="Variation title (e.g. Hidden subfloor sharps sweep)..."
                        value={varTitle}
                        onChange={(e) => setVarTitle(e.target.value)}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs sm:col-span-5"
                      />
                      <input
                        type="text"
                        placeholder="Site justification / reason..."
                        value={varReason}
                        onChange={(e) => setVarReason(e.target.value)}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs sm:col-span-4"
                      />
                      <input
                        type="number"
                        placeholder="Ex GST $"
                        value={varAmount}
                        onChange={(e) => setVarAmount(e.target.value)}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs sm:col-span-1"
                      />
                      <button
                        onClick={() => {
                          if (!varTitle.trim()) return;
                          createVariation(opCo.id, {
                            title: varTitle.trim(),
                            reason: varReason.trim() || "Additional unforeseen site scope.",
                            amountExGst: Math.max(0, Number(varAmount) || 0),
                          });
                          setVarTitle("");
                          setVarReason("");
                          setVarAmount("450");
                          setVarOpCoId(null);
                        }}
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 sm:col-span-2"
                      >
                        Submit
                      </button>
                    </div>
                  )}

                  {opCo.variations.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 py-4 text-center text-xs text-slate-400">
                      No variations raised under {opCo.agreementRef}.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {opCo.variations.map((v) => (
                        <div
                          key={v.id}
                          className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 text-xs sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[11px] font-semibold text-indigo-700">
                                {v.reference}
                              </span>
                              <span className="font-semibold text-slate-900">
                                {v.title}
                              </span>
                              <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-800 ring-1 ring-slate-200">
                                {formatAUD(v.amountExGst)} ex GST ({formatAUD(v.amountExGst * 1.1)}{" "}
                                inc. GST)
                              </span>
                            </div>
                            <p className="mt-1 text-slate-600">{v.reason}</p>
                            <div className="mt-1 text-[11px] text-slate-400">
                              Raised by {v.createdBy} · {v.createdAt}
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            {v.status === "pending_coordinator" && (
                              <>
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
                                  Awaiting Scoping Desk
                                </span>
                                {role.type === "coordinator" && (
                                  <button
                                    onClick={() => issueVariationToClient(opCo.id, v.id)}
                                    className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800"
                                  >
                                    <Send className="h-3 w-3" />
                                    Verify & Send to Client
                                  </button>
                                )}
                              </>
                            )}
                            {v.status === "sent_to_client" && (
                              <>
                                <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-800">
                                  Awaiting Client Sign-Off
                                </span>
                                {role.type === "client" && (
                                  <div className="flex gap-1.5">
                                    <button
                                      onClick={() =>
                                        respondVariationAsClient(opCo.id, v.id, false)
                                      }
                                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                      <XCircle className="h-3.5 w-3.5 text-rose-500" />
                                      Decline
                                    </button>
                                    <button
                                      onClick={() =>
                                        respondVariationAsClient(opCo.id, v.id, true)
                                      }
                                      className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-800"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      Approve Addendum
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                            {v.status === "approved" && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Approved ({v.approvedBy})
                              </span>
                            )}
                            {v.status === "declined" && (
                              <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-medium text-rose-700">
                                Declined
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
