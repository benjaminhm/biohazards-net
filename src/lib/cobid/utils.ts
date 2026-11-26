import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { LineItem, OpCoScope, VariationOrder } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatAUD(amount: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function nowAuLabel(): string {
  return new Date().toLocaleString("en-AU", {
    timeZone: "Australia/Brisbane",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function todayAuLabel(): string {
  return new Date().toLocaleDateString("en-AU", {
    timeZone: "Australia/Brisbane",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function calcTotals(
  lineItems: LineItem[],
  depositPercent: number,
  variations: VariationOrder[] = []
) {
  const baseSubtotal = lineItems.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
  const approvedVariationsExGst = variations
    .filter((v) => v.status === "approved")
    .reduce((sum, v) => sum + v.amountExGst, 0);

  const subtotal = baseSubtotal + approvedVariationsExGst;
  const gst = subtotal * 0.1;
  const totalIncGst = subtotal + gst;

  // Deposit is calculated on original contracted base inc. GST
  const baseIncGst = baseSubtotal * 1.1;
  const depositAmount = baseIncGst * (depositPercent / 100);
  const balanceAmount = totalIncGst - depositAmount;

  return {
    baseSubtotal,
    approvedVariationsExGst,
    subtotal,
    gst,
    totalIncGst,
    depositAmount,
    balanceAmount,
  };
}

export function isUpstreamHandoverComplete(opCo: OpCoScope, allOpCos: OpCoScope[]): boolean {
  if (!opCo.dependsOnOpCoId) return true;
  const upstream = allOpCos.find((o) => o.id === opCo.dependsOnOpCoId);
  if (!upstream) return true;
  const handoverMilestone = upstream.milestones.find((m) => m.isHandoverGate);
  if (handoverMilestone) {
    return handoverMilestone.status === "completed";
  }
  return upstream.milestones.every((m) => m.status === "completed");
}

export function getOpCoProgressPercent(opCo: OpCoScope): number {
  if (opCo.milestones.length === 0) return 0;
  const completed = opCo.milestones.filter((m) => m.status === "completed").length;
  return Math.round((completed / opCo.milestones.length) * 100);
}
