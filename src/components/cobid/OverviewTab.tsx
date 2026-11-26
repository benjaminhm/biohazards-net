"use client";

import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  FileSignature,
  Landmark,
  Lock,
  MapPin,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import {
  calcTotals,
  formatAUD,
  getOpCoProgressPercent,
  isUpstreamHandoverComplete,
} from "@/lib/cobid/utils";
import { AgreementBadge, DepositBadge, ScopeBadge } from "./StatusBadge";

interface OverviewTabProps {
  onNavigateTab: (tab: string) => void;
}

export function OverviewTab({ onNavigateTab }: OverviewTabProps) {
  const { activeJob, role, setRole, session } = useWorkspace();
  if (!activeJob) return null;

  const visibleOpCos =
    role.type === "contractor"
      ? activeJob.opCos.filter((o) => o.id === role.opCoId)
      : activeJob.opCos;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  Independent Co-Bid Settlement Workspace
                </h2>
                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  No Partnership · No Subcontracting
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Each remediation OpCo enters a{" "}
                <span className="font-medium text-slate-900">
                  separate, direct legal agreement
                </span>{" "}
                with the client.{" "}
                {activeJob.settlementRail === "direct_to_opco"
                  ? "Deposits and progress payments settle directly to each individual OpCo's nominated bank/merchant account."
                  : "Funds are held in a Statutory Clearing Trust and disbursed directly to each individual OpCo upon settlement milestones."}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <Landmark className="h-4 w-4 text-slate-600" />
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                Settlement Rail
              </div>
              <div className="font-semibold text-slate-900">
                {activeJob.settlementRail === "direct_to_opco"
                  ? "Direct to OpCo"
                  : "Trust Clearing → OpCos"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <MapPin className="h-3.5 w-3.5" />
            Site & Property
          </div>
          <div className="mt-1.5 text-sm font-semibold text-slate-900">
            {activeJob.propertyAddress}
          </div>
          <div className="text-xs text-slate-600">{activeJob.suburbState}</div>
          <p className="mt-2.5 border-t border-slate-100 pt-2 text-xs text-slate-500">
            {activeJob.siteAccessNotes}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <UserCheck className="h-3.5 w-3.5" />
            Client & Lead Provenance
          </div>
          <div className="mt-1.5 text-sm font-semibold text-slate-900">
            {activeJob.clientName}
          </div>
          <div className="text-xs text-slate-600">{activeJob.clientRole}</div>
          <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
            <span className="text-slate-500">Lead Origin:</span>
            <span className="font-medium text-slate-800">{activeJob.leadSource}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-slate-500">Scoping Desk:</span>
            <span className="font-medium text-slate-800">{activeJob.coordinatorName}</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            Quick Role Actions
          </div>
          <div className="mt-2 space-y-2">
            {role.type === "coordinator" && (
              <>
                <button
                  onClick={() => onNavigateTab("scopes")}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-800 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  <span>Review & Manage OpCo Scopes</span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                </button>
                <button
                  onClick={() => onNavigateTab("agreements")}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-800 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  <span>Track Individual Agreements & Deposits</span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                </button>
              </>
            )}
            {role.type === "client" && (
              <>
                <button
                  onClick={() => onNavigateTab("agreements")}
                  className="flex w-full items-center justify-between rounded-lg bg-slate-900 px-3 py-2 text-left text-xs font-medium text-white transition hover:bg-slate-800"
                >
                  <span>Sign Individual Agreements & Pay Deposits</span>
                  <FileSignature className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onNavigateTab("progress")}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-800 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  <span>View Live Site Progress & Timeline</span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                </button>
              </>
            )}
            {role.type === "contractor" && (
              <>
                <button
                  onClick={() => onNavigateTab("scopes")}
                  className="flex w-full items-center justify-between rounded-lg bg-slate-900 px-3 py-2 text-left text-xs font-medium text-white transition hover:bg-slate-800"
                >
                  <span>Review / Approve My Scope & Estimate</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onNavigateTab("progress")}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-800 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  <span>Update Milestones & Site Logs</span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Sequenced Co-Bid Parties & Handover Gates
            </h3>
            <p className="text-xs text-slate-500">
              {role.type === "contractor"
                ? "Commercial pricing of other OpCos is ring-fenced. You can see upstream handover readiness only."
                : "Each party holds an independent scope, contract, and deposit rail sequenced on one shared timeline."}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {activeJob.opCos.map((opCo) => {
            const isOwnOpCo = role.type !== "contractor" || role.opCoId === opCo.id;
            const totals = calcTotals(opCo.lineItems, opCo.depositPercent, opCo.variations);
            const progress = getOpCoProgressPercent(opCo);
            const upstreamReady = isUpstreamHandoverComplete(opCo, activeJob.opCos);
            const upstreamOpCo = opCo.dependsOnOpCoId
              ? activeJob.opCos.find((o) => o.id === opCo.dependsOnOpCoId)
              : null;

            return (
              <div
                key={opCo.id}
                className={`rounded-xl border p-4 transition ${
                  isOwnOpCo
                    ? "border-slate-200 bg-white"
                    : "border-dashed border-slate-200 bg-slate-50/70"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-xs font-bold text-slate-800">
                      {opCo.monogram}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                          Stage {opCo.sequenceOrder}
                        </span>
                        <span className="text-xs font-medium text-slate-500">
                          {opCo.tradeCategory}
                        </span>
                      </div>
                      <h4 className="mt-0.5 text-sm font-semibold text-slate-900">
                        {opCo.companyName}
                      </h4>
                      <div className="text-[11px] text-slate-500">
                        ABN {opCo.abn} · Licence {opCo.licenceNumber}
                      </div>
                    </div>
                  </div>
                  {role.type === "coordinator" && session?.source === "staff" && (
                    <button
                      onClick={() => setRole({ type: "contractor", opCoId: opCo.id })}
                      className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                      title="Preview as this Contractor"
                    >
                      View as OpCo
                    </button>
                  )}
                </div>

                {upstreamOpCo && (
                  <div
                    className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                      upstreamReady
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                    }`}
                  >
                    {upstreamReady ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Lock className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>
                      {upstreamReady
                        ? `Handover gate cleared by ${upstreamOpCo.companyName}`
                        : `Mobilises after Stage ${upstreamOpCo.sequenceOrder} (${upstreamOpCo.companyName}) Clearance Handover`}
                    </span>
                  </div>
                )}

                {isOwnOpCo ? (
                  <>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <ScopeBadge status={opCo.scopeStatus} />
                      <AgreementBadge status={opCo.agreementStatus} />
                      <DepositBadge status={opCo.depositStatus} />
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
                      <div>
                        <div className="text-[11px] text-slate-500">Contract Total</div>
                        <div className="mt-0.5 font-semibold text-slate-900">
                          {formatAUD(totals.totalIncGst)}
                        </div>
                        <div className="text-[10px] text-slate-400">inc. GST</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500">
                          Deposit ({opCo.depositPercent}%)
                        </div>
                        <div className="mt-0.5 font-semibold text-slate-900">
                          {formatAUD(totals.depositAmount)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {opCo.depositStatus === "paid" ? "Settled" : "Direct to OpCo"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500">Site Progress</div>
                        <div className="mt-0.5 font-semibold text-slate-900">{progress}%</div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-slate-900 transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-500">
                    <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
                    <span>
                      Separate OpCo — Commercial estimate & agreement ring-fenced. Site progress:{" "}
                      <strong className="text-slate-700">{progress}%</strong>
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {visibleOpCos.length > 1 && (
          <div className="mt-4 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Combined indicative project value across{" "}
              <strong className="text-slate-900">{visibleOpCos.length} independent contracts</strong>{" "}
              (for budgeting reference only — invoiced separately):
            </span>
            <span className="text-sm font-bold text-slate-900">
              {formatAUD(
                visibleOpCos.reduce(
                  (acc, o) =>
                    acc + calcTotals(o.lineItems, o.depositPercent, o.variations).totalIncGst,
                  0
                )
              )}{" "}
              <span className="text-[11px] font-normal text-slate-500">inc. GST</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
