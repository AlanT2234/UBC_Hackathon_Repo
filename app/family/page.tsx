"use client";

import Link from "next/link";
import { ApprovalRow } from "@/components/family/approval-row";
import { ActivityTable } from "@/components/family/activity-table";
import { FreezeControl } from "@/components/family/freeze-control";
import { ScamCallDemo } from "@/components/family/scam-call-demo";
import { Money } from "@/components/money";
import { useGuardian } from "@/lib/use-guardian";

export default function FamilyHomePage() {
  const { account, frozen, connection, payments } = useGuardian();
  const pending = payments.filter((payment) => payment.status === "held");
  const spentToday = payments
    .filter((payment) => {
      if (payment.status !== "paid" || !payment.decidedAt) return false;
      const decided = new Date(payment.decidedAt);
      const now = new Date();
      return (
        decided.getFullYear() === now.getFullYear() &&
        decided.getMonth() === now.getMonth() &&
        decided.getDate() === now.getDate()
      );
    })
    .reduce((sum, payment) => sum + payment.amountCents, 0);

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Payments for {account.seniorName || "your family member"} that need a person, not the assistant.
          </p>
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="surface-dark rounded-lg bg-navy px-4 py-3 text-cream">
            <dt className="text-xs font-bold uppercase tracking-wide text-cream/75">Available</dt>
            <dd className="font-display text-2xl font-extrabold tracking-tight">
              <Money cents={account.balanceCents} />
            </dd>
          </div>
          <div className="rounded-lg border border-t-4 border-t-teal bg-card px-4 py-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Paid today</dt>
            <dd className="font-display text-2xl font-extrabold tracking-tight">
              <Money cents={spentToday} />
            </dd>
          </div>
          <div className="rounded-lg border border-t-4 border-t-held bg-card px-4 py-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Waiting for you</dt>
            <dd className="font-display text-2xl font-extrabold tracking-tight">{account.pendingCount}</dd>
          </div>
        </dl>
      </header>

      {connection === "live" ? (
        <FreezeControl frozen={frozen} seniorName={account.seniorName} />
      ) : null}

      {connection === "live" ? <ScamCallDemo /> : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Waiting for you</h2>
        {pending.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            Nothing is waiting. New or unusual payments will show up here.
          </p>
        ) : (
          <div className="space-y-2">
            {pending.map((payment) => (
              <ApprovalRow key={payment.id} payment={payment} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-bold">Recent activity</h2>
          <Link href="/family/history" className="text-sm font-bold text-navy underline underline-offset-2">
            Full payment history
          </Link>
        </div>
        <ActivityTable payments={payments.slice(0, 5)} />
      </section>
    </div>
  );
}
