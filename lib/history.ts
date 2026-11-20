import { formatDollars } from "@/lib/format";
import type { Payment, PaymentOutcome } from "@/lib/types";

export const OUTCOME_LABEL: Record<PaymentOutcome, string> = {
  paid: "Paid",
  held: "Waiting for family",
  refused: "Refused",
  declined: "Declined by family",
  expired: "Expired, refunded",
};

export type HistoryFilter = "all" | "paid" | "held" | "stopped";

export const FILTERS: { id: HistoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "paid", label: "Paid" },
  { id: "held", label: "Waiting" },
  { id: "stopped", label: "Stopped" },
];

export function matches(payment: Payment, filter: HistoryFilter): boolean {
  if (filter === "all") return true;
  if (filter === "stopped") return payment.status === "blocked";
  return payment.status === filter;
}

export type Totals = { cents: number; count: number };

/** Paid out, waiting in escrow, and stopped (refused, declined or expired: money that stayed home). */
export function totals(payments: Payment[]): Record<"paid" | "held" | "stopped", Totals> {
  const out = { paid: { cents: 0, count: 0 }, held: { cents: 0, count: 0 }, stopped: { cents: 0, count: 0 } };
  for (const p of payments) {
    const bucket = p.status === "blocked" ? out.stopped : out[p.status];
    bucket.cents += p.amountCents;
    bucket.count += 1;
  }
  return out;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(date) === dayKey(today)) return "Today";
  if (dayKey(date) === dayKey(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(date);
}

export type DayGroup = { key: string; label: string; payments: Payment[]; paidCents: number };

/** Groups newest-first payments by the day they were requested, keeping their order. */
export function byDay(payments: Payment[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const p of payments) {
    const date = new Date(p.requestedAt);
    const key = dayKey(date);
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      group = { key, label: dayLabel(date), payments: [], paidCents: 0 };
      groups.push(group);
    }
    group.payments.push(p);
    if (p.status === "paid") group.paidCents += p.amountCents;
  }
  return groups;
}

export function timeOf(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function approvalLine(payment: Payment): string | null {
  // A paid hold's reason already names who approved it.
  const names = payment.approvedBy;
  if (payment.outcome === "held") {
    const so = names.length > 0 ? ` (${names.join(" and ")} approved)` : "";
    return `${names.length} of ${Math.max(payment.approvalsRequired, 1)} family approvals${so}`;
  }
  return null;
}

export function expiresLine(payment: Payment): string | null {
  if (payment.outcome !== "held" || payment.expiresInSeconds === null) return null;
  const minutes = Math.ceil(payment.expiresInSeconds / 60);
  if (minutes <= 0) return "Expiring now; the money goes back to her balance";
  return `If nobody approves within ${minutes} min, the money goes back to her balance`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Itemized history as CSV, for a guardian's records. */
export function toCsv(payments: Payment[]): string {
  const header = ["Requested", "Decided", "Payee", "For", "Amount", "Outcome", "Reason", "Approved by", "Transaction"];
  const rows = payments.map((p) => [
    new Date(p.requestedAt).toLocaleString("en-US"),
    p.decidedAt ? new Date(p.decidedAt).toLocaleString("en-US") : "",
    p.recipientName,
    p.purpose,
    formatDollars(p.amountCents),
    OUTCOME_LABEL[p.outcome],
    p.reason,
    p.approvedBy.join("; "),
    p.explorerUrl ?? "",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
