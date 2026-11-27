export type UserRole =
  | { type: "coordinator" }
  | { type: "client" }
  | { type: "contractor"; opCoId: string };

export type SettlementRail = "direct_to_opco" | "trust_clearing";

export type OnboardingStatus =
  | "invited"
  | "in_progress"
  | "pending_review"
  | "approved"
  | "suspended";

export type OpCoComplianceDocType =
  | "public_liability"
  | "workcover"
  | "trade_licence"
  | "hazmat_licence"
  | "swms"
  | "other";

export type QuoteType = "bcq" | "sacq" | "ccq" | "mtq" | "custom";

export const QUOTE_TYPE_META: Record<
  QuoteType,
  { code: string; label: string; description: string }
> = {
  bcq: {
    code: "BCQ",
    label: "Biohazard Cleaning Quote",
    description: "Forensic, biological, trauma, unattended death, or sharps remediation",
  },
  sacq: {
    code: "SACQ",
    label: "Surface Area Cleaning Quote",
    description: "Decontamination, antimicrobial treatment, odour & surface restoration",
  },
  ccq: {
    code: "CCQ",
    label: "Contents Clearance Quote",
    description: "Affected contents sort, removal, hazmat disposal, and manifest tracking",
  },
  mtq: {
    code: "MTQ",
    label: "Meth Testing Quote",
    description: "Presumptive / NATA lab meth residue sampling and clearance testing",
  },
  custom: {
    code: "TRADE",
    label: "Specialist Trade Quote",
    description: "Asbestos removal, strip-out, rebuild, plumbing, electrical, or specialist works",
  },
};

export interface StructuredQuoteData {
  roomsOrZones?: string[];
  hazardClassification?: string;
  standardsApplied?: string[];
  ppeAndContainment?: string;
  wasteDisposalNotes?: string;
  siteConditions?: string;
  estimatedDuration?: string;
  specialNotes?: string;
}

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

export interface OpCoComplianceDoc {
  id: string;
  opCoId: string;
  docType: OpCoComplianceDocType;
  title: string;
  documentNumber: string;
  issuerOrInsurer: string;
  coverageAmount: string;
  expiresAt: string | null;
  filePath: string;
  fileName: string;
  status: "pending" | "verified" | "rejected";
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  rejectionReason?: string | null;
  isExpired: boolean;
}

export interface OpCoXeroSummary {
  connected: boolean;
  tenantName?: string;
  status: "not_connected" | "connected" | "disconnected" | "error";
  accountCode: string;
  invoiceMode: "authorised" | "draft";
  lastError?: string | null;
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
  directoryOpCoId?: string;
  sequenceOrder: number;
  dependsOnOpCoId?: string;
  tradeCategory: string;
  quoteType: QuoteType;
  independentJobRef?: string;
  structuredQuoteData?: StructuredQuoteData;
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

  // Scoping & Estimating (built by OpCo on BCQ/SACQ page, then approved)
  scopeSummary: string;
  scopeDeliverables: string[];
  exclusions: string[];
  lineItems: LineItem[];
  scopeStatus: ScopeApprovalStatus;
  revisionNote?: string;
  contractorApprovedAt?: string;

  // Independent Entity Document & Legal Agreement (separate URL on docs.hazmatmanagement.com.au)
  agreementRef: string;
  agreementStatus: AgreementStatus;
  agreementSentAt?: string;
  clientSignedAt?: string;
  clientSignedBy?: string;
  agreementAuditHash?: string;
  docStatus?: "not_sent" | "open" | "signed" | "declined" | "voided";
  docUrl?: string;
  docViewedAt?: string;
  docDeclineReason?: string;
  bidUrl?: string;

  // Per-OpCo Xero Direct Invoicing
  xeroDepositInvoiceId?: string;
  xeroDepositInvoiceNumber?: string;
  xeroDepositOnlineUrl?: string;
  xeroBalanceInvoiceId?: string;
  xeroBalanceInvoiceNumber?: string;
  xeroBalanceOnlineUrl?: string;
  xeroLastSyncedAt?: string;
  xeroLastError?: string;

  // Individual Deposit & Final Balance (paid directly to OpCo unless Trust Clearing enabled)
  depositStatus: PaymentStatus;
  depositPaidAt?: string;
  depositPaymentRef?: string;
  depositMethod?:
    | "Bank Transfer / PayID"
    | "Direct Card (OpCo Merchant)"
    | "Xero Online Invoice"
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
  linkedJobId?: string;
  sharedPhotoIds?: string[];
  packageUrl?: string;
  packageSentAt?: string;
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
  legalEntityName: string;
  tradingName: string;
  abn: string;
  acn: string;
  gstRegistered: boolean;
  licenceNumber: string;
  monogram: string;
  contactName: string;
  contactEmail: string;
  phone: string;
  logoPath?: string | null;
  serviceRegions: string[];
  allowedQuoteTypes: QuoteType[];
  termsAndConditions: string;
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
  onboardingStatus: OnboardingStatus;
  onboardingToken?: string | null;
  onboardingExpiresAt?: string | null;
  deedSignedAt?: string | null;
  deedSignedBy?: string | null;
  deedSignedTitle?: string | null;
  deedAuditHash?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  reviewNotes?: string | null;
  complianceDocs: OpCoComplianceDoc[];
  hasExpiredCompliance: boolean;
  xero: OpCoXeroSummary;
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
