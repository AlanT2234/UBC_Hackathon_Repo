import { Ban, Check, Clock } from "lucide-react";
import { statusLabel } from "@/lib/format";
import type { PaymentStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const styles: Record<PaymentStatus, string> = {
  paid: "bg-safe-soft text-safe",
  held: "bg-held-soft text-held",
  blocked: "bg-blocked-soft text-blocked",
};

export function StatusMark({
  status,
  size = "family",
  label,
}: {
  status: PaymentStatus;
  size?: "senior" | "family";
  /** Overrides the default label, e.g. "Declined by family" in the itemized history. */
  label?: string;
}) {
  const iconClass = size === "senior" ? "h-7 w-7" : "h-4 w-4";
  const Icon = status === "paid" ? Check : status === "held" ? Clock : Ban;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap rounded-full font-bold",
        styles[status],
        size === "senior" ? "px-4 py-2 text-xl" : "px-2.5 py-1 text-xs",
      )}
    >
      <Icon className={iconClass} aria-hidden="true" strokeWidth={2.5} />
      {label ?? statusLabel(status)}
    </span>
  );
}
