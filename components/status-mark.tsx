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
}: {
  status: PaymentStatus;
  size?: "senior" | "family";
}) {
  const label = statusLabel(status);
  const iconClass = size === "senior" ? "h-7 w-7" : "h-4 w-4";
  const Icon = status === "paid" ? Check : status === "held" ? Clock : Ban;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-md font-bold",
        styles[status],
        size === "senior" ? "px-4 py-2 text-xl" : "px-2 py-1 text-xs",
      )}
    >
      <Icon className={iconClass} aria-hidden="true" strokeWidth={2.25} />
      {label}
    </span>
  );
}
