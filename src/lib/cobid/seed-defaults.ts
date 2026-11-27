import type { DirectoryOpCo } from "./types";

export type SeedOpCoTemplate = Pick<
  DirectoryOpCo,
  | "key"
  | "tradeCategory"
  | "companyName"
  | "abn"
  | "licenceNumber"
  | "monogram"
  | "contactName"
  | "contactEmail"
  | "bankName"
  | "bsb"
  | "accountNumber"
  | "payId"
  | "defaultDepositPercent"
  | "defaultScopeSummary"
  | "defaultDeliverables"
  | "defaultExclusions"
  | "defaultLineItems"
  | "defaultMilestones"
  | "defaultComplianceDocs"
>;

export const DEFAULT_OPCO_TEMPLATES: SeedOpCoTemplate[] = [
  {
    key: "hoard",
    tradeCategory: "Hoarding Clearance & Waste Removal",
    companyName: "Hoarding Clearance QLD",
    abn: "00 000 000 000",
    licenceNumber: "QLD-EPA-WM-PENDING",
    monogram: "HC",
    contactName: "Operations Desk",
    contactEmail: "admin@hoardingclearanceqld.com.au",
    bankName: "Edit in OpCo Directory",
    bsb: "000-000",
    accountNumber: "0000 0000",
    payId: "admin@hoardingclearanceqld.com.au",
    defaultDepositPercent: 30,
    defaultScopeSummary:
      "Structured sorting, compassionate salvage triage, bulk clutter removal, and licensed EPA waste disposal to achieve a broom-swept structural handover.",
    defaultDeliverables: [
      "Salvage triage table for client-nominated personal & legal items",
      "Bulk clearance and licensed waste disposal with weighbridge dockets",
      "Broom-swept handover ready for downstream remediation",
    ],
    defaultExclusions: [
      "Biohazard, sharps, or gross filth chemical decontamination",
      "Structural carpentry, plumbing, or electrical works",
    ],
    defaultLineItems: [
      {
        code: "HC-101",
        description: "Senior Hoarding Technicians (3-person crew × 2 days)",
        unit: "Crew Day",
        qty: 2,
        unitPrice: 1850,
        category: "Labour",
      },
      {
        code: "HC-204",
        description: "Bulk Waste Removal & Licensed Transfer Station Tip Fees",
        unit: "m³",
        qty: 14,
        unitPrice: 115,
        category: "Disposal",
      },
    ],
    defaultMilestones: [
      {
        title: "Site Mobilisation & Salvage Triage",
        description: "Confirm salvage protocol and establish safe access corridor.",
        targetDay: "Day 1 AM",
      },
      {
        title: "Clearance Handover Gate (Broom-Swept)",
        description: "Bulk clutter removed and site certified ready for next trade.",
        targetDay: "Day 2 PM",
        isHandoverGate: true,
      },
    ],
    defaultComplianceDocs: [
      "Licensed Waste Transfer & Weighbridge Docket",
      "Salvage Chain-of-Custody Log",
    ],
  },
  {
    key: "squalor",
    tradeCategory: "Biohazard & Squalor Remediation",
    companyName: "Biohazard Cleaning QLD",
    abn: "00 000 000 000",
    licenceNumber: "IICRC-TCST-PENDING",
    monogram: "BC",
    contactName: "Operations Desk",
    contactEmail: "admin@biohazardcleaningqld.com.au",
    bankName: "Edit in OpCo Directory",
    bsb: "000-000",
    accountNumber: "0000 0000",
    payId: "admin@biohazardcleaningqld.com.au",
    defaultDepositPercent: 30,
    defaultScopeSummary:
      "Forensic biohazard cleaning, gross filth decontamination of wet areas and hard surfaces, hospital-grade antimicrobial treatment, odour neutralisation, and ATP verification.",
    defaultDeliverables: [
      "Full biohazard PPE & HEPA air scrubbing during decontamination",
      "Enzymatic deep sanitisation of kitchen, bathroom & hard floors",
      "Post-remediation ATP swab verification & Hygiene Clearance Certificate",
    ],
    defaultExclusions: [
      "Bulk hoarding clutter removal",
      "Painting, flooring replacement, or pest fumigation",
    ],
    defaultLineItems: [
      {
        code: "GF-101",
        description: "IICRC Biohazard & Squalor Remediation Crew (2 techs × 2 days)",
        unit: "Crew Day",
        qty: 2,
        unitPrice: 2150,
        category: "Labour",
      },
      {
        code: "GF-410",
        description: "ATP Bioluminescence Verification & Hygiene Clearance Certificate",
        unit: "Test Pack",
        qty: 1,
        unitPrice: 390,
        category: "Verification",
      },
    ],
    defaultMilestones: [
      {
        title: "Containment & Gross Filth Decontamination",
        description: "Mobilise post-clearance and remediate kitchen, wet areas, and floors.",
        targetDay: "Day 3",
      },
      {
        title: "ATP Clearance Testing & Hygiene Sign-Off",
        description: "ATP swab verification (< 30 RLU) and certificate issuance.",
        targetDay: "Day 4 PM",
        isHandoverGate: true,
      },
    ],
    defaultComplianceDocs: [
      "ATP Bioluminescence Hygiene Clearance Certificate",
      "Clinical / Bio-Waste Disposal Manifest",
    ],
  },
  {
    key: "water",
    tradeCategory: "Emergency Water Mitigation & Drying",
    companyName: "Partner Water & Drying OpCo",
    abn: "00 000 000 000",
    licenceNumber: "IICRC-WRT-PENDING",
    monogram: "WD",
    contactName: "Partner Lead",
    contactEmail: "partner-water@example.com.au",
    bankName: "Edit in OpCo Directory",
    bsb: "000-000",
    accountNumber: "0000 0000",
    payId: "partner-water@example.com.au",
    defaultDepositPercent: 30,
    defaultScopeSummary:
      "Water extraction, affected carpet/plasterboard strip-out, and monitored structural drying to IICRC S500 dry-standard targets.",
    defaultDeliverables: [
      "Water extraction and controlled strip-out of affected materials",
      "LGR dehumidification & daily psychrometric moisture logging",
      "IICRC S500 Dry-Standard Handover Certificate",
    ],
    defaultExclusions: [
      "Microbial mould remediation",
      "Plasterboard reinstatement and painting",
    ],
    defaultLineItems: [
      {
        code: "WM-101",
        description: "Extraction & Controlled Strip-Out (2 techs × 1 day)",
        unit: "Day",
        qty: 1,
        unitPrice: 1650,
        category: "Labour",
      },
      {
        code: "WM-204",
        description: "LGR Dehumidifier & Air Mover Package (4 days)",
        unit: "Day",
        qty: 4,
        unitPrice: 380,
        category: "Equipment",
      },
    ],
    defaultMilestones: [
      {
        title: "Extraction & Strip-Out",
        description: "Remove affected floor coverings and perform flood-cut.",
        targetDay: "Day 1",
      },
      {
        title: "Structural Drying Handover Gate",
        description: "Timber framing verified ≤ 14% MC; ready for downstream works.",
        targetDay: "Day 4",
        isHandoverGate: true,
      },
    ],
    defaultComplianceDocs: ["IICRC S500 Psychrometric Drying Certificate"],
  },
  {
    key: "mould",
    tradeCategory: "Microbial & Mould Remediation",
    companyName: "Partner Mould Remediation OpCo",
    abn: "00 000 000 000",
    licenceNumber: "IICRC-AMRT-PENDING",
    monogram: "MR",
    contactName: "Partner Lead",
    contactEmail: "partner-mould@example.com.au",
    bankName: "Edit in OpCo Directory",
    bsb: "000-000",
    accountNumber: "0000 0000",
    payId: "partner-mould@example.com.au",
    defaultDepositPercent: 30,
    defaultScopeSummary:
      "Negative-pressure containment, HEPA sandwich cleaning, antimicrobial treatment, and independent post-remediation air spore clearance.",
    defaultDeliverables: [
      "6-mil poly containment with negative air HEPA filtration",
      "HEPA vacuuming and antimicrobial remediation of framing & cavities",
      "Independent spore trap clearance & IICRC S520 report",
    ],
    defaultExclusions: ["Initial water extraction", "Structural reconstruction"],
    defaultLineItems: [
      {
        code: "MR-101",
        description: "Containment, HEPA Sandwich Cleaning & Cavity Remediation",
        unit: "Allow",
        qty: 1,
        unitPrice: 2450,
        category: "Remediation",
      },
      {
        code: "MR-205",
        description: "Post-Remediation Air Spore Verification & S520 Report",
        unit: "Test Pack",
        qty: 1,
        unitPrice: 490,
        category: "Verification",
      },
    ],
    defaultMilestones: [
      {
        title: "Containment & Cavity Remediation",
        description: "Erect negative air containment and complete HEPA treatment.",
        targetDay: "Day 5",
      },
      {
        title: "Air Spore Clearance Sign-Off",
        description: "Lab clearance verified and S520 certificate issued.",
        targetDay: "Day 6",
        isHandoverGate: true,
      },
    ],
    defaultComplianceDocs: ["IICRC S520 Spore Clearance Report"],
  },
  {
    key: "pest",
    tradeCategory: "Post-Clearance Pest & Vector Control",
    companyName: "Partner Pest & Vector OpCo",
    abn: "00 000 000 000",
    licenceNumber: "QLD-PMT-PENDING",
    monogram: "PV",
    contactName: "Partner Lead",
    contactEmail: "partner-pest@example.com.au",
    bankName: "Edit in OpCo Directory",
    bsb: "000-000",
    accountNumber: "0000 0000",
    payId: "partner-pest@example.com.au",
    defaultDepositPercent: 30,
    defaultScopeSummary:
      "Targeted German cockroach, rodent, and vector eradication across cleared kitchen, subfloor, and roof void following squalor decontamination.",
    defaultDeliverables: [
      "Residual perimeter barrier & gel baiting across wet areas and cabinetry",
      "Lockable tamper-resistant rodent baiting stations",
      "Licensed Pest Eradication & Safe Re-Entry Certificate",
    ],
    defaultExclusions: ["Hoarding clearance", "Biohazard surface cleaning"],
    defaultLineItems: [
      {
        code: "PV-101",
        description: "Full Severe-Infestation Cockroach & Rodent Eradication Treatment",
        unit: "Treatment",
        qty: 1,
        unitPrice: 890,
        category: "Pest Control",
      },
      {
        code: "PV-102",
        description: "14-Day Follow-Up Inspection & Clearance Certificate",
        unit: "Visit",
        qty: 1,
        unitPrice: 260,
        category: "Verification",
      },
    ],
    defaultMilestones: [
      {
        title: "Primary Vector Eradication Treatment",
        description: "Apply licensed residual & baiting protocol across cleared property.",
        targetDay: "Day 5 PM",
      },
      {
        title: "Safe Re-Entry & Pest Clearance Sign-Off",
        description: "Issue licensed clearance certificate for client handover.",
        targetDay: "Day 6 AM",
        isHandoverGate: true,
      },
    ],
    defaultComplianceDocs: ["Licensed Pest Treatment & Safe Re-Entry Certificate"],
  },
];
