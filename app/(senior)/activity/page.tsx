"use client";

import Link from "next/link";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { StatusMark } from "@/components/status-mark";
import { Button } from "@/components/ui/button";
import { formatWhen } from "@/lib/format";
import { useGuardian } from "@/lib/use-guardian";

export default function ActivityPage() {
  const { payments } = useGuardian();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        size="senior"
        title="Recent payments"
        description="What the contract did with each request."
      />
      <ul className="space-y-4">
        {payments.map((payment) => (
          <li key={payment.id} className="rounded-lg border border-border bg-card px-5 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-serif text-3xl font-medium">{payment.recipientName}</p>
              <StatusMark status={payment.status} size="senior" />
            </div>
            <p className="mt-3 font-serif text-4xl font-medium">
              <Money cents={payment.amountCents} />
            </p>
            <p className="mt-2 text-xl leading-relaxed">{payment.purpose}</p>
            <p className="mt-2 text-xl leading-relaxed">{payment.reason}</p>
            <p className="mt-3 text-xl">{formatWhen(payment.requestedAt, "senior")}</p>
          </li>
        ))}
      </ul>
      <Button asChild size="senior" className="mt-2">
        <Link href="/">Talk to Guardian</Link>
      </Button>
    </div>
  );
}
