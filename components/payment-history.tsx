"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, ExternalLink } from "lucide-react";
import { Money } from "@/components/money";
import { StatusMark } from "@/components/status-mark";
import { Button } from "@/components/ui/button";
import {
  FILTERS,
  OUTCOME_LABEL,
  approvalLine,
  byDay,
  expiresLine,
  matches,
  timeOf,
  toCsv,
  totals,
  type HistoryFilter,
} from "@/lib/history";
import type { Payment } from "@/lib/types";
import { cn } from "@/lib/utils";

type Size = "senior" | "family";

/**
 * Itemized payment history: every request SafeNSound handled, grouped by day, with what it was
 * for, the outcome and why, who approved it, and the onchain transaction when there is one.
 */
export function PaymentHistory({ payments, size = "family" }: { payments: Payment[]; size?: Size }) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const senior = size === "senior";
  const sum = totals(payments);
  const shown = payments.filter((p) => matches(p, filter));

  function download() {
    const blob = new Blob([toCsv(shown)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `safensound-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={cn(senior ? "space-y-6" : "space-y-5")}>
      <dl className={cn("grid gap-3", senior ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-3")}>
        <Tile label="Paid" total={sum.paid} tone="paid" size={size} />
        <Tile label="Waiting for family" total={sum.held} tone="held" size={size} />
        <Tile label="Stopped, money kept" total={sum.stopped} tone="stopped" size={size} />
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={cn(
                "rounded-full border-2 font-bold",
                senior ? "px-5 py-2 text-xl" : "px-3 py-1 text-sm",
                filter === f.id ? "border-navy bg-navy text-cream" : "border-border bg-card text-ink hover:border-navy",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {senior ? null : (
          <Button type="button" variant="outline" size="sm" onClick={download} disabled={shown.length === 0}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download CSV
          </Button>
        )}
      </div>

      {shown.length === 0 ? (
        <p
          className={cn(
            "rounded-lg border border-dashed border-border px-4 py-6 text-muted-foreground",
            senior ? "text-xl" : "text-sm",
          )}
        >
          {payments.length === 0 ? "No payments yet." : "Nothing here for this filter."}
        </p>
      ) : (
        byDay(shown).map((day) => (
          <section key={day.key} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 border-b border-border pb-1">
              <h2 className={cn("font-display font-extrabold tracking-tight", senior ? "text-2xl" : "text-base")}>
                {day.label}
              </h2>
              {day.paidCents > 0 ? (
                <p className={cn("text-muted-foreground", senior ? "text-lg" : "text-xs")}>
                  Paid <Money cents={day.paidCents} className="font-bold text-ink" />
                </p>
              ) : null}
            </div>
            <ol className="space-y-2">
              {day.payments.map((p) => (
                <HistoryItem key={p.id} payment={p} size={size} />
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}

function Tile({
  label,
  total,
  tone,
  size,
}: {
  label: string;
  total: { cents: number; count: number };
  tone: "paid" | "held" | "stopped";
  size: Size;
}) {
  const senior = size === "senior";
  const accent = tone === "paid" ? "border-t-teal" : tone === "held" ? "border-t-held" : "border-t-blocked";
  return (
    <div className={cn("rounded-lg border border-t-4 bg-card", accent, senior ? "px-5 py-4" : "px-3 py-2.5")}>
      <dt className={cn("text-muted-foreground", senior ? "text-lg" : "text-xs font-bold uppercase tracking-wide")}>
        {label}
      </dt>
      <dd className={cn("font-display font-extrabold tracking-tight", senior ? "text-3xl" : "text-xl")}>
        <Money cents={total.cents} />
      </dd>
      <dd className={cn("text-muted-foreground", senior ? "text-lg" : "text-xs")}>
        {total.count} {total.count === 1 ? "payment" : "payments"}
      </dd>
    </div>
  );
}

function HistoryItem({ payment: p, size }: { payment: Payment; size: Size }) {
  const senior = size === "senior";
  const approval = approvalLine(p);
  const expires = expiresLine(p);
  const stopped = p.status === "blocked";

  return (
    <li
      className={cn(
        "grid gap-x-4 gap-y-1 rounded-lg border bg-card",
        p.outcome === "held" ? "border-held/40" : "border-border",
        senior ? "grid-cols-1 px-5 py-4" : "grid-cols-[4.5rem_1fr_auto] px-4 py-3",
      )}
    >
      <p className={cn("text-muted-foreground tabular-nums", senior ? "text-lg" : "pt-0.5 text-sm")}>
        {timeOf(p.requestedAt)}
      </p>
      <div className="min-w-0 space-y-1">
        <p className={cn("font-bold text-ink", senior ? "text-2xl" : "text-sm")}>{p.recipientName}</p>
        {p.purpose ? (
          <p className={cn("text-muted-foreground", senior ? "text-lg" : "text-sm")}>
            <span className="font-bold">For:</span> {p.purpose}
          </p>
        ) : null}
        <p className={cn("leading-relaxed text-ink", senior ? "text-lg" : "text-sm")}>{p.reason}</p>
        {approval ? <p className={cn("text-teal-deep font-bold", senior ? "text-lg" : "text-xs")}>{approval}</p> : null}
        {expires ? <p className={cn("text-held", senior ? "text-lg" : "text-xs")}>{expires}</p> : null}
        <div className={cn("flex flex-wrap gap-x-4 gap-y-1", senior ? "text-lg" : "text-xs")}>
          {p.decidedAt && p.decidedAt !== p.requestedAt ? (
            <span className="text-muted-foreground">
              {OUTCOME_LABEL[p.outcome]} at {timeOf(p.decidedAt)}
            </span>
          ) : null}
          {p.explorerUrl ? (
            <a
              href={p.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-bold text-navy underline underline-offset-2"
            >
              View transaction
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
          {p.outcome === "held" && !senior ? (
            <Link href={`/family/approvals/${p.id}`} className="font-bold text-navy underline underline-offset-2">
              Review and decide
            </Link>
          ) : null}
        </div>
      </div>
      <div className={cn("flex items-start gap-3", senior ? "flex-wrap pt-1" : "flex-col items-end")}>
        <Money
          cents={p.amountCents}
          className={cn(
            "font-display font-extrabold tracking-tight",
            senior ? "text-3xl" : "text-base",
            stopped && "text-muted-foreground",
          )}
        />
        <StatusMark status={p.status} label={OUTCOME_LABEL[p.outcome]} size={senior ? "senior" : "family"} />
      </div>
    </li>
  );
}
