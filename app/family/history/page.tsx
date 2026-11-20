"use client";

import { PaymentHistory } from "@/components/payment-history";
import { useGuardian } from "@/lib/use-guardian";

export default function HistoryPage() {
  const { account, connection, payments } = useGuardian();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Payment history</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every payment {account.seniorName || "your family member"} asked for, what it was for, what the contract decided and why.
        </p>
      </header>
      {connection === "connecting" ? (
        <p className="text-sm text-muted-foreground">Loading.</p>
      ) : (
        <PaymentHistory payments={payments} />
      )}
    </div>
  );
}
