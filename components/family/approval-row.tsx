import Link from "next/link";
import { Money } from "@/components/money";
import { StatusMark } from "@/components/status-mark";
import { formatWhen } from "@/lib/format";
import type { Payment } from "@/lib/types";

export function ApprovalRow({ payment }: { payment: Payment }) {
  return (
    <Link
      href={`/family/approvals/${payment.id}`}
      className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-border bg-card px-4 py-3 hover:bg-secondary"
    >
      <span>
        <span className="block text-sm font-semibold text-ink">{payment.recipientName}</span>
        <span className="block text-sm text-muted-foreground">
          {payment.purpose} · {formatWhen(payment.requestedAt, "family")}
        </span>
      </span>
      <span className="flex items-center gap-3">
        <Money cents={payment.amountCents} className="text-sm font-semibold" />
        <StatusMark status="held" />
      </span>
    </Link>
  );
}
