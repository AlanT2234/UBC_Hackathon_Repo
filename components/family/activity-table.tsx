import { Money } from "@/components/money";
import { StatusMark } from "@/components/status-mark";
import { formatWhen } from "@/lib/format";
import type { Payment } from "@/lib/types";

export function ActivityTable({ payments }: { payments: Payment[] }) {
  if (payments.length === 0) {
    return <p className="text-sm text-muted-foreground">No payments yet.</p>;
  }

  return (
    <>
      <ul className="space-y-2 md:hidden">
        {payments.map((payment) => (
          <li key={payment.id} className="rounded-md border border-border bg-card px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-semibold">{payment.recipientName}</span>
              <Money cents={payment.amountCents} className="text-sm font-semibold" />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{payment.purpose}</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <StatusMark status={payment.status} />
              <span className="text-xs text-muted-foreground">
                {formatWhen(payment.requestedAt, "family")}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-hidden rounded-md border border-border bg-card md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Amount</th>
              <th className="px-4 py-2 font-medium">To</th>
              <th className="px-4 py-2 font-medium">For</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium">
                  <Money cents={payment.amountCents} />
                </td>
                <td className="px-4 py-3">{payment.recipientName}</td>
                <td className="px-4 py-3 text-muted-foreground">{payment.purpose}</td>
                <td className="px-4 py-3">
                  <StatusMark status={payment.status} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {formatWhen(payment.requestedAt, "family")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
