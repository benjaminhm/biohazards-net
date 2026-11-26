"use client";

import { useState } from "react";
import {
  Briefcase,
  Building2,
  ClipboardCheck,
  Database,
  FileSignature,
  FileText,
  KeyRound,
  Layers,
  ListChecks,
  Lock,
  LogOut,
  Mail,
  MessageSquare,
  Plus,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import { ActivityAuditTab } from "./ActivityAuditTab";
import { AgreementsDepositsTab } from "./AgreementsDepositsTab";
import { CompletionPackTab } from "./CompletionPackTab";
import { InviteModal } from "./InviteModal";
import { NewJobModal } from "./NewJobModal";
import { OpCoDirectoryModal } from "./OpCoDirectoryModal";
import { OverviewTab } from "./OverviewTab";
import { ProjectProgressTab } from "./ProjectProgressTab";
import { ScopesEstimatesTab } from "./ScopesEstimatesTab";

const TABS = [
  { id: "overview", label: "Overview & Sequencing", icon: Layers },
  { id: "scopes", label: "Scopes & Estimates", icon: FileText },
  { id: "agreements", label: "Agreements & Settlements", icon: FileSignature },
  { id: "progress", label: "Project, Logs & Variations", icon: ListChecks },
  { id: "completion", label: "Completion Pack", icon: ClipboardCheck },
  { id: "activity", label: "Activity & Messaging", icon: MessageSquare },
];

function CoordinatorSignInScreen() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/cobid/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Could not send sign-in link.");
      } else {
        setSentMessage(data?.message || "If that email can sign in, a link is on its way.");
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 bg-slate-950 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-xs font-bold text-slate-950">
              HM
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Hazmat Management · Co-Bid
              </div>
              <h1 className="text-base font-semibold">Coordinator Workspace Sign-In</h1>
            </div>
          </div>
        </div>

        <div className="p-6 text-xs">
          {sentMessage ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
              <div className="font-semibold">Check your inbox</div>
              <p className="mt-1 text-emerald-800">{sentMessage}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="leading-relaxed text-slate-600">
                Sign in with your Hazmat Management coordinator email to manage Co-Bid workspaces,
                partner OpCos, and client invites. External OpCos and clients should use their
                workspace magic link.
              </p>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Coordinator Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@hazmatmanagement.com.au"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={sending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <Mail className="h-4 w-4" />
                {sending ? "Sending Sign-In Link…" : "Email Me a Sign-In Link"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export function WorkspaceShell() {
  const {
    jobs,
    activeJob,
    activeJobId,
    setActiveJobId,
    role,
    setRole,
    session,
    authState,
    logout,
    dbStatus,
  } = useWorkspace();
  const [activeTab, setActiveTab] = useState("overview");
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);

  if (authState === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-xs text-slate-500">
        Loading Hazmat Management Co-Bid Workspace…
      </div>
    );
  }

  if (authState === "unauthenticated" || !session) {
    return <CoordinatorSignInScreen />;
  }

  const isStaffCoordinator = session.source === "staff" && session.roleType === "coordinator";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Bar: Locked Magic-Link Session OR Authenticated Coordinator Preview Switcher */}
      <div className="no-print border-b border-slate-800 bg-slate-950 text-slate-200">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
          {session.source === "magic_link" ? (
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2.5 py-1 font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                <Lock className="h-3.5 w-3.5" />
                Authenticated via Magic Link
              </span>
              <span className="font-medium text-white">{session.name}</span>
              <span className="text-slate-400">({session.email})</span>
              <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                {session.roleType}
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold uppercase tracking-wider text-slate-400">
                Coordinator View:
              </span>
              <button
                onClick={() => setRole({ type: "coordinator" })}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                  role.type === "coordinator"
                    ? "bg-white text-slate-950"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                <Briefcase className="h-3.5 w-3.5" />
                Scoping Desk
              </button>

              {activeJob?.opCos.map((opCo) => {
                const active = role.type === "contractor" && role.opCoId === opCo.id;
                return (
                  <button
                    key={opCo.id}
                    onClick={() => setRole({ type: "contractor", opCoId: opCo.id })}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                      active
                        ? "bg-white text-slate-950"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    <Users className="h-3.5 w-3.5" />
                    Preview S{opCo.sequenceOrder}: {opCo.monogram}
                  </button>
                );
              })}

              {activeJob && (
                <button
                  onClick={() => setRole({ type: "client" })}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                    role.type === "client"
                      ? "bg-emerald-400 text-slate-950"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  <User className="h-3.5 w-3.5" />
                  Preview Client ({activeJob.clientName.split(" ")[0]})
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${
                dbStatus === "error"
                  ? "border-rose-700 bg-rose-950 text-rose-300"
                  : dbStatus === "saving" || dbStatus === "loading"
                    ? "border-amber-700 bg-amber-950/60 text-amber-300"
                    : "border-emerald-800 bg-emerald-950/60 text-emerald-300"
              }`}
            >
              <Database className="h-3 w-3" />
              {dbStatus === "saving"
                ? "Saving…"
                : dbStatus === "loading"
                  ? "Syncing…"
                  : dbStatus === "error"
                    ? "Sync Error"
                    : "Supabase · Live"}
            </span>
            <button
              onClick={logout}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-700"
            >
              <LogOut className="h-3 w-3" />
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {/* Main Neutral Workspace Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold tracking-tight text-white">
                HM
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold tracking-tight text-slate-900">
                    Hazmat Management · Co-Bid
                  </span>
                  {activeJob && (
                    <>
                      <span className="text-slate-300">/</span>
                      <span className="font-mono text-xs font-medium text-slate-500">
                        {activeJob.reference}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                        {activeJob.leadSourceType}
                      </span>
                    </>
                  )}
                </div>
                {activeJob ? (
                  <h1 className="text-base font-semibold text-slate-900 sm:text-lg">
                    {activeJob.propertyAddress}, {activeJob.suburbState}{" "}
                    <span className="font-normal text-slate-400">—</span>{" "}
                    <span className="font-normal text-slate-600">{activeJob.title}</span>
                  </h1>
                ) : (
                  <h1 className="text-base font-semibold text-slate-900 sm:text-lg">
                    Independent Multi-OpCo Remediation Workspaces
                  </h1>
                )}
              </div>
            </div>

            <div className="no-print flex flex-wrap items-center gap-2">
              {jobs.length > 1 && activeJobId && (
                <>
                  <label className="text-xs font-medium text-slate-500">Workspace:</label>
                  <select
                    value={activeJobId}
                    onChange={(e) => setActiveJobId(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-xs focus:border-slate-900 focus:outline-none"
                  >
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.reference} — {j.propertyAddress} ({j.suburbState.split(" ")[0]})
                      </option>
                    ))}
                  </select>
                </>
              )}
              {isStaffCoordinator && (
                <>
                  <button
                    onClick={() => setDirectoryOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-xs hover:bg-slate-50"
                  >
                    <Building2 className="h-3.5 w-3.5" />
                    OpCo Directory
                  </button>
                  {activeJob && (
                    <button
                      onClick={() => setInviteOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-xs hover:bg-slate-50"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Invite Parties
                    </button>
                  )}
                  <button
                    onClick={() => setNewJobOpen(true)}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New Workspace
                  </button>
                </>
              )}
            </div>
          </div>

          {activeJob && (
            <nav className="no-print -mb-4 mt-4 flex gap-1 overflow-x-auto border-t border-slate-100 pt-2">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-medium transition ${
                      isActive
                        ? "border-slate-900 text-slate-900"
                        : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {!activeJob ? (
          <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-slate-900">
              No Co-Bid Workspaces Yet
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Set up your real Operating Companies in the OpCo Directory, then create your first
              multi-trade Co-Bid workspace with ring-fenced scopes, independent bilateral agreements,
              and sequenced handover gates.
            </p>
            {isStaffCoordinator && (
              <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                <button
                  onClick={() => setDirectoryOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  <Building2 className="h-4 w-4" />
                  Configure OpCo Directory
                </button>
                <button
                  onClick={() => setNewJobOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  <Plus className="h-4 w-4" />
                  Create First Workspace
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {activeTab === "overview" && <OverviewTab onNavigateTab={setActiveTab} />}
            {activeTab === "scopes" && <ScopesEstimatesTab onNavigateTab={setActiveTab} />}
            {activeTab === "agreements" && <AgreementsDepositsTab />}
            {activeTab === "progress" && <ProjectProgressTab />}
            {activeTab === "completion" && <CompletionPackTab />}
            {activeTab === "activity" && <ActivityAuditTab />}
          </>
        )}
      </main>

      <NewJobModal open={newJobOpen} onClose={() => setNewJobOpen(false)} />
      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <OpCoDirectoryModal open={directoryOpen} onClose={() => setDirectoryOpen(false)} />
    </div>
  );
}
