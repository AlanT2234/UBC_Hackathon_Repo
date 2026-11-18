"use client";

import { ApprovalRow } from "@/components/family/approval-row";
import { ActivityTable } from "@/components/family/activity-table";
import { Money } from "@/components/money";
import { useGuardian } from "@/lib/use-guardian";

export default function FamilyHomePage() {
  const { account, payments } = useGuardian();
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
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-medium">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Payments for {account.seniorName} that need a person, not the assistant.
          </p>
        </div>
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-muted-foreground">Available</dt>
            <dd className="font-semibold">
              <Money cents={account.balanceCents} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Paid today</dt>
            <dd className="font-semibold">
              <Money cents={spentToday} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Waiting</dt>
            <dd className="font-semibold">{account.pendingCount}</dd>
          </div>
        </dl>
      </header>

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
        <h2 className="text-sm font-semibold">Activity</h2>
        <ActivityTable payments={payments} />
      </section>
    </div>
  );
}
