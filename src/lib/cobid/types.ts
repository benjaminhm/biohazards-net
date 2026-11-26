export type UserRole =
  | { type: "coordinator" }
  | { type: "client" }
  | { type: "contractor"; opCoId: string };

export type SettlementRail = "direct_to_opco" | "trust_clearing";

export type ScopeApprovalStatus =
  | "draft"
  | "pending_contractor"
  | "revision_requested"
  | "contractor_approved";

export type AgreementStatus =
  | "not_ready"
  | "ready_to_send"
  | "sent_to_client"
  | "signed";

export type PaymentStatus = "pending" | "paid";

export type VariationStatus =
  | "pending_coordinator"
  | "sent_to_client"
  | "approved"
  | "declined";

export interface LineItem {
  id: string;
  code: string;
  description: string;
  unit: string;
  qty: number;
  unitPrice: number; // ex GST in AUD
  category: string;
}

export interface VariationOrder {
  id: string;
  reference: string;
  title: string;
  reason: string;
  amountExGst: number;
  status: VariationStatus;
  createdAt: string;
  createdBy: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface Milestone {
  id: string;
  title: string;
  description: string;
  targetDay: string;
  status: "locked" | "pending" | "in_progress" | "completed";
  completedAt?: string;
  isHandoverGate?: boolean;
}

export interface ProgressLog {
  id: string;
  timestamp: string;
  author: string;
  summary: string;
  stage: "before" | "during" | "after" | "compliance";
  photoLabel?: string;
  photoTone?: string;
  photoUrl?: string;
}

export interface ComplianceDoc {
  id: string;
  title: string;
  reference: string;
  issuedAt: string;
  status: "verified" | "pending";
  fileUrl?: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  category: "workspace" | "scope" | "legal" | "settlement" | "operations" | "variation";
  summary: string;
  /** If set, commercial details are visible only to Coordinator, Client, and this OpCo */
  restrictedToOpCoId?: string;
}

export interface WorkspaceMessage {
  id: string;
  channel: "shared_ops" | string; // "shared_ops" or a scope id for private commercial thread
  timestamp: string;
  senderName: string;
  senderRoleLabel: string;
  body: string;
}

export interface OpCoScope {
  id: string;
  sequenceOrder: number;
  dependsOnOpCoId?: string;
  tradeCategory: string;
  companyName: string;
  abn: string;
  licenceNumber: string;
  monogram: string;
  contactName: string;
  contactEmail: string;
  // Direct-to-OpCo banking details
  bankName: string;
  bsb: string;
  accountNumber: string;
  payId: string;
  depositPercent: number;

  // Scoping & Estimating (done-for-you, then approved)
  scopeSummary: string;
  scopeDeliverables: string[];
  exclusions: string[];
  lineItems: LineItem[];
  scopeStatus: ScopeApprovalStatus;
  revisionNote?: string;
  contractorApprovedAt?: string;

  // Individual Legal Agreement (strictly separate per OpCo)
  agreementRef: string;
  agreementStatus: AgreementStatus;
  agreementSentAt?: string;
  clientSignedAt?: string;
  clientSignedBy?: string;
  agreementAuditHash?: string;

  // Individual Deposit & Final Balance (paid directly to OpCo unless Trust Clearing enabled)
  depositStatus: PaymentStatus;
  depositPaidAt?: string;
  depositPaymentRef?: string;
  depositMethod?:
    | "Bank Transfer / PayID"
    | "Direct Card (OpCo Merchant)"
    | "Trust Clearing Allocation";

  balanceStatus: PaymentStatus;
  balancePaidAt?: string;
  balancePaymentRef?: string;
  balanceInvoiceRef: string;

  // Mid-Job Variations (strictly per OpCo)
  variations: VariationOrder[];

  // Execution & Progress
  milestones: Milestone[];
  progressLogs: ProgressLog[];

  // Completion & Handover
  completionSignedOff: boolean;
  completionSignedAt?: string;
  completionNotes?: string;
  complianceDocs: ComplianceDoc[];
}

export interface JobWorkspace {
  id: string;
  reference: string;
  title: string;
  propertyAddress: string;
  suburbState: string;
  leadSource: string;
  leadSourceType:
    | "NDIS / Support Coordinator"
    | "Insurer"
    | "Strata / Property Manager"
    | "Direct Client"
    | "Contractor Referral";
  createdAt: string;
  clientName: string;
  clientRole: string;
  clientEmail: string;
  clientPhone: string;
  settlementRail: SettlementRail;
  coordinatorName: string;
  siteAccessNotes: string;
  opCos: OpCoScope[];
  auditLog: AuditEvent[];
  messages: WorkspaceMessage[];
}

export interface DirectoryOpCo {
  id: string;
  key: string;
  tradeCategory: string;
  companyName: string;
  abn: string;
  licenceNumber: string;
  monogram: string;
  contactName: string;
  contactEmail: string;
  bankName: string;
  bsb: string;
  accountNumber: string;
  payId: string;
  defaultDepositPercent: number;
  defaultScopeSummary: string;
  defaultDeliverables: string[];
  defaultExclusions: string[];
  defaultLineItems: {
    code: string;
    description: string;
    unit: string;
    qty: number;
    unitPrice: number;
    category: string;
  }[];
  defaultMilestones: {
    title: string;
    description: string;
    targetDay: string;
    isHandoverGate?: boolean;
  }[];
  defaultComplianceDocs: string[];
  isActive: boolean;
}

export interface CobidSessionInfo {
  source: "staff" | "magic_link";
  email: string;
  name: string;
  roleType: "coordinator" | "contractor" | "client";
  opCoId?: string;
  jobId?: string;
  orgId: string;
  expiresAt?: string;
}
