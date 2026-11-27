"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type {
  CobidSessionInfo,
  DirectoryOpCo,
  JobWorkspace,
  LineItem,
  Milestone,
  ProgressLog,
  QuoteType,
  SettlementRail,
  UserRole,
} from "@/lib/cobid/types";

export interface NewJobPayload {
  title: string;
  propertyAddress: string;
  suburbState: string;
  clientName: string;
  clientRole: string;
  clientEmail: string;
  clientPhone: string;
  leadSource: string;
  leadSourceType: JobWorkspace["leadSourceType"];
  settlementRail: SettlementRail;
  siteAccessNotes: string;
  selectedOpCoKeys: string[];
  quoteTypesByOpCo?: Record<string, QuoteType>;
  linkedJobId?: string;
  sharedPhotoIds?: string[];
}

export interface BidInviteResult {
  bidUrl: string;
  emailSent: boolean;
  emailError?: string;
}

export interface DispatchDocsResult {
  packageUrl: string;
  documents: Array<{
    scopeId: string;
    stageOrder: number;
    companyName: string;
    independentJobRef: string;
    docUrl: string;
  }>;
  emailSent: boolean;
  emailError?: string;
}

interface WorkspaceContextValue {
  jobs: JobWorkspace[];
  activeJob: JobWorkspace | null;
  activeJobId: string | null;
  setActiveJobId: (id: string) => void;
  directory: DirectoryOpCo[];
  refreshDirectory: () => Promise<void>;
  saveDirectoryOpCo: (
    opCo: Partial<DirectoryOpCo> & { companyName: string; tradeCategory: string }
  ) => Promise<void>;
  archiveDirectoryOpCo: (id: string) => Promise<void>;
  role: UserRole;
  setRole: (role: UserRole) => void;
  session: CobidSessionInfo | null;
  authState: "checking" | "authenticated" | "unauthenticated";
  logout: () => Promise<void>;
  dbStatus: "loading" | "synced" | "saving" | "error";

  // Job intake
  createJobWorkspace: (payload: NewJobPayload) => Promise<void>;

  // Coordinator actions
  setSettlementRail: (rail: SettlementRail) => Promise<void>;
  addLineItem: (opCoId: string, item: Omit<LineItem, "id">) => Promise<void>;
  removeLineItem: (opCoId: string, lineItemId: string) => Promise<void>;
  sendScopeToContractor: (opCoId: string) => Promise<void>;
  sendAgreementToClient: (opCoId: string) => Promise<void>;

  // Phase 2 & 3 Coordinator actions
  issueBidInvite: (opCoId: string, sendEmail?: boolean) => Promise<BidInviteResult>;
  dispatchEntityDocs: (sendEmail?: boolean) => Promise<DispatchDocsResult>;
  syncXeroPayments: () => Promise<{ updatedCount: number; errors: string[] }>;
  raiseXeroInvoice: (
    opCoId: string,
    kind: "deposit" | "balance"
  ) => Promise<{ ok: boolean; invoiceNumber?: string; onlineUrl?: string | null; error?: string }>;

  // Contractor actions
  approveScopeAsContractor: (opCoId: string) => Promise<void>;
  requestScopeRevision: (opCoId: string, note: string) => Promise<void>;
  updateMilestoneStatus: (
    opCoId: string,
    milestoneId: string,
    status: Milestone["status"]
  ) => Promise<void>;
  addProgressLog: (opCoId: string, log: Omit<ProgressLog, "id" | "timestamp">) => Promise<void>;
  attachComplianceDoc: (
    opCoId: string,
    docId: string,
    fileUrl: string,
    reference: string
  ) => Promise<void>;
  signOffCompletion: (opCoId: string, notes: string) => Promise<void>;

  // Variations (strictly per OpCo)
  createVariation: (
    opCoId: string,
    variation: { title: string; reason: string; amountExGst: number }
  ) => Promise<void>;
  issueVariationToClient: (opCoId: string, variationId: string) => Promise<void>;
  respondVariationAsClient: (
    opCoId: string,
    variationId: string,
    approve: boolean
  ) => Promise<void>;

  // Client actions (strictly individual per OpCo)
  signOpCoAgreement: (opCoId: string, signerName: string) => Promise<void>;
  payOpCoDeposit: (
    opCoId: string,
    method: "Bank Transfer / PayID" | "Direct Card (OpCo Merchant)" | "Trust Clearing Allocation"
  ) => Promise<void>;
  payOpCoBalance: (opCoId: string) => Promise<void>;

  // Messaging
  postMessage: (channel: string, body: string) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<JobWorkspace[]>([]);
  const [directory, setDirectory] = useState<DirectoryOpCo[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [role, setRoleState] = useState<UserRole>({ type: "coordinator" });
  const [session, setSession] = useState<CobidSessionInfo | null>(null);
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "unauthenticated">(
    "checking"
  );
  const [dbStatus, setDbStatus] = useState<"loading" | "synced" | "saving" | "error">("loading");

  const fetchWorkspaces = useCallback(async (currentRole: UserRole) => {
    try {
      const params = new URLSearchParams();
      params.set("role", currentRole.type);
      if (currentRole.type === "contractor") {
        params.set("opCoId", currentRole.opCoId);
      }
      const res = await fetch(`/api/cobid/workspaces?${params.toString()}`, {
        cache: "no-store",
      });
      if (res.status === 401) {
        setSession(null);
        setAuthState("unauthenticated");
        setDbStatus("synced");
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch workspaces");

      const data = (await res.json()) as {
        jobs: JobWorkspace[];
        session: CobidSessionInfo | null;
        directory?: DirectoryOpCo[];
      };

      if (!data.session) {
        setSession(null);
        setAuthState("unauthenticated");
        setDbStatus("synced");
        return;
      }

      setSession(data.session);
      setAuthState("authenticated");

      if (data.session.source === "magic_link") {
        const enforcedRole: UserRole =
          data.session.roleType === "contractor" && data.session.opCoId
            ? { type: "contractor", opCoId: data.session.opCoId }
            : data.session.roleType === "client"
              ? { type: "client" }
              : { type: "coordinator" };
        setRoleState((prev) =>
          JSON.stringify(prev) === JSON.stringify(enforcedRole) ? prev : enforcedRole
        );
      }

      if (Array.isArray(data.directory)) {
        setDirectory(data.directory);
      }

      const nextJobs = Array.isArray(data.jobs) ? data.jobs : [];
      setJobs(nextJobs);
      setActiveJobId((prev) => {
        if (prev && nextJobs.some((j) => j.id === prev)) return prev;
        return nextJobs[0]?.id ?? null;
      });
      setDbStatus("synced");
    } catch (err) {
      console.error(err);
      setDbStatus("error");
    }
  }, []);

  const refreshDirectory = useCallback(async () => {
    const res = await fetch("/api/cobid/opcos", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { opCos: DirectoryOpCo[] };
      setDirectory(data.opCos ?? []);
    }
  }, []);

  const saveDirectoryOpCo = async (
    opCo: Partial<DirectoryOpCo> & { companyName: string; tradeCategory: string }
  ) => {
    setDbStatus("saving");
    try {
      const res = await fetch("/api/cobid/opcos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opCo),
      });
      if (!res.ok) throw new Error("Failed to save OpCo");
      await refreshDirectory();
      setDbStatus("synced");
    } catch (err) {
      console.error(err);
      setDbStatus("error");
    }
  };

  const archiveDirectoryOpCo = async (id: string) => {
    setDbStatus("saving");
    try {
      const res = await fetch(`/api/cobid/opcos?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to archive OpCo");
      await refreshDirectory();
      setDbStatus("synced");
    } catch (err) {
      console.error(err);
      setDbStatus("error");
    }
  };

  const logout = async () => {
    await fetch("/api/cobid/auth/logout", { method: "POST" });
    setRoleState({ type: "coordinator" });
    await fetchWorkspaces({ type: "coordinator" });
  };

  useEffect(() => {
    fetchWorkspaces(role);
  }, [role, fetchWorkspaces]);

  const activeJob = jobs.find((j) => j.id === activeJobId) ?? jobs[0] ?? null;

  const setRole = (nextRole: UserRole) => {
    if (session?.source === "magic_link") return;
    setRoleState(nextRole);
  };

  const handleSetActiveJobId = (id: string) => {
    setActiveJobId(id);
    if (role.type === "contractor" && session?.source !== "magic_link") {
      const nextJob = jobs.find((j) => j.id === id);
      if (!nextJob?.opCos.some((o) => o.id === role.opCoId)) {
        setRoleState({ type: "coordinator" });
      }
    }
  };

  const applyJobUpdate = (updated: JobWorkspace) => {
    setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
  };

  const dispatchAction = async (action: string, payload: Record<string, unknown>) => {
    if (!activeJob) return;
    setDbStatus("saving");
    try {
      const res = await fetch(`/api/cobid/workspaces/${activeJob.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, role, payload }),
      });
      if (!res.ok) throw new Error(`Action ${action} failed`);
      const data = (await res.json()) as { job: JobWorkspace };
      applyJobUpdate(data.job);
      setDbStatus("synced");
    } catch (err) {
      console.error(err);
      setDbStatus("error");
    }
  };

  const createJobWorkspace = async (payload: NewJobPayload) => {
    setDbStatus("saving");
    try {
      const res = await fetch("/api/cobid/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDbStatus("error");
        throw new Error(data?.error || "Create workspace failed");
      }
      const created = data.job as JobWorkspace;
      setJobs((prev) => [created, ...prev]);
      setActiveJobId(created.id);
      setRoleState({ type: "coordinator" });
      setDbStatus("synced");
    } catch (err) {
      console.error(err);
      setDbStatus("error");
      throw err;
    }
  };

  const issueBidInvite = async (opCoId: string, sendEmail = true): Promise<BidInviteResult> => {
    if (!activeJob) throw new Error("No active workspace");
    setDbStatus("saving");
    try {
      const res = await fetch(`/api/cobid/workspaces/${activeJob.id}/bid-invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opCoId, sendEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to issue bid invite");
      if (data.job) applyJobUpdate(data.job);
      setDbStatus("synced");
      return {
        bidUrl: data.bidUrl,
        emailSent: Boolean(data.emailSent),
        emailError: data.emailError,
      };
    } catch (err) {
      setDbStatus("error");
      throw err;
    }
  };

  const dispatchEntityDocs = async (sendEmail = true): Promise<DispatchDocsResult> => {
    if (!activeJob) throw new Error("No active workspace");
    setDbStatus("saving");
    try {
      const res = await fetch(`/api/cobid/workspaces/${activeJob.id}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to dispatch entity documents");
      if (data.job) applyJobUpdate(data.job);
      setDbStatus("synced");
      return {
        packageUrl: data.packageUrl,
        documents: data.documents ?? [],
        emailSent: Boolean(data.emailSent),
        emailError: data.emailError,
      };
    } catch (err) {
      setDbStatus("error");
      throw err;
    }
  };

  const syncXeroPayments = async () => {
    if (!activeJob) return { updatedCount: 0, errors: [] };
    setDbStatus("saving");
    try {
      const res = await fetch(`/api/cobid/workspaces/${activeJob.id}/xero-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Xero sync failed");
      if (data.job) applyJobUpdate(data.job);
      setDbStatus("synced");
      const results = (data.syncResults ?? []) as Array<{ updated?: boolean; error?: string }>;
      return {
        updatedCount: results.filter((r) => r.updated).length,
        errors: results.map((r) => r.error).filter((e): e is string => Boolean(e)),
      };
    } catch (err) {
      setDbStatus("error");
      throw err;
    }
  };

  const raiseXeroInvoice = async (opCoId: string, kind: "deposit" | "balance") => {
    if (!activeJob) return { ok: false, error: "No active workspace" };
    setDbStatus("saving");
    try {
      const res = await fetch(`/api/cobid/workspaces/${activeJob.id}/xero-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "raise_invoice", opCoId, kind }),
      });
      const data = await res.json();
      if (data.job) applyJobUpdate(data.job);
      setDbStatus("synced");
      return data.invoiceResult ?? { ok: false, error: data?.error || "Invoice failed" };
    } catch (err) {
      setDbStatus("error");
      return { ok: false, error: err instanceof Error ? err.message : "Invoice failed" };
    }
  };

  return (
    <WorkspaceContext.Provider
      value={{
        jobs,
        activeJob,
        activeJobId,
        setActiveJobId: handleSetActiveJobId,
        directory,
        refreshDirectory,
        saveDirectoryOpCo,
        archiveDirectoryOpCo,
        role,
        setRole,
        session,
        authState,
        logout,
        dbStatus,
        createJobWorkspace,
        setSettlementRail: (rail) => dispatchAction("set_settlement_rail", { rail }),
        addLineItem: (opCoId, item) => dispatchAction("add_line_item", { opCoId, item }),
        removeLineItem: (opCoId, lineItemId) =>
          dispatchAction("remove_line_item", { opCoId, lineItemId }),
        sendScopeToContractor: (opCoId) =>
          dispatchAction("send_scope_to_contractor", { opCoId }),
        sendAgreementToClient: (opCoId) => dispatchAction("send_agreement", { opCoId }),
        issueBidInvite,
        dispatchEntityDocs,
        syncXeroPayments,
        raiseXeroInvoice,
        approveScopeAsContractor: (opCoId) => dispatchAction("approve_scope", { opCoId }),
        requestScopeRevision: (opCoId, note) =>
          dispatchAction("request_revision", { opCoId, note }),
        updateMilestoneStatus: (opCoId, milestoneId, status) =>
          dispatchAction("update_milestone", { opCoId, milestoneId, status }),
        addProgressLog: (opCoId, log) =>
          dispatchAction("add_progress_log", { opCoId, ...log }),
        attachComplianceDoc: (opCoId, docId, fileUrl, reference) =>
          dispatchAction("attach_compliance_doc", { opCoId, docId, fileUrl, reference }),
        signOffCompletion: (opCoId, notes) =>
          dispatchAction("sign_off_completion", { opCoId, notes }),
        createVariation: (opCoId, variation) =>
          dispatchAction("create_variation", { opCoId, ...variation }),
        issueVariationToClient: (opCoId, variationId) =>
          dispatchAction("issue_variation", { opCoId, variationId }),
        respondVariationAsClient: (opCoId, variationId, approve) =>
          dispatchAction("respond_variation", { opCoId, variationId, approve }),
        signOpCoAgreement: (opCoId, signerName) =>
          dispatchAction("sign_agreement", { opCoId, signerName }),
        payOpCoDeposit: (opCoId, method) => dispatchAction("pay_deposit", { opCoId, method }),
        payOpCoBalance: (opCoId) => dispatchAction("pay_balance", { opCoId }),
        postMessage: (channel, body) => dispatchAction("post_message", { channel, body }),
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return ctx;
}
