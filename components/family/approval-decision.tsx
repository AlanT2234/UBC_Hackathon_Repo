"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/money";
import { StatusMark } from "@/components/status-mark";
import { approvePayment, approverFor, declinePayment } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import type { Payment } from "@/lib/types";

export function ApprovalDecision({ payment: current }: { payment: Payment }) {
  const [pending, setPending] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const waiting = current.status === "held";
  const approver = waiting ? approverFor(current) : null;

  async function run(kind: "approve" | "decline") {
    setPending(kind);
    setError(null);
    try {
      // The page re-renders from the live snapshot once the backend confirms.
      if (kind === "approve") await approvePayment(current.id);
      else await declinePayment(current.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The contract did not answer. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <article className="mx-auto max-w-xl space-y-6">
      <Link href="/family" className="text-sm font-medium text-muted-foreground">
        Back to overview
      </Link>
      <div className="space-y-2">
        <StatusMark status={current.status} />
        <p className="font-display text-4xl font-extrabold tracking-tight">
          <Money cents={current.amountCents} />
        </p>
        <h1 className="text-lg font-semibold">{current.recipientName}</h1>
        <p className="text-sm text-muted-foreground">
          {current.purpose ? `${current.purpose} · ` : ""}Asked {formatWhen(current.requestedAt, "family")}
        </p>
      </div>
      <section className="rounded-md border border-border bg-card px-4 py-3">
        <h2 className="text-sm font-semibold">What the contract decided</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink">{current.reason}</p>
        {current.explorerUrl ? (
          <a
            href={current.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-sm font-medium text-muted-foreground underline"
          >
            View on Solana Explorer
          </a>
        ) : null}
      </section>
      {waiting ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            className="sm:flex-1"
            disabled={pending !== null}
            onClick={() => void run("approve")}
          >
            {pending === "approve"
              ? "Asking the contract"
              : approver
                ? `Approve as ${approver.name}`
                : "Approve payment"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="sm:flex-1"
            disabled={pending !== null}
            onClick={() => void run("decline")}
          >
            {pending === "decline" ? "Asking the contract" : "Decline"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          This request is finished. The assistant cannot reopen it.
        </p>
      )}
      {error ? <p className="text-sm text-blocked">{error}</p> : null}
    </article>
  );
}
