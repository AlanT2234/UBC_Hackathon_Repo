import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function ContractNotice({
  size = "family",
  className,
}: {
  size?: "senior" | "family";
  className?: string;
}) {
  const senior = size === "senior";
  return (
    <p
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border bg-card text-ink",
        senior ? "px-5 py-4 text-xl leading-snug" : "px-3 py-2 text-sm leading-snug",
        className,
      )}
    >
      <ShieldCheck
        className={senior ? "mt-1 h-7 w-7 shrink-0" : "mt-0.5 h-4 w-4 shrink-0"}
        aria-hidden="true"
        strokeWidth={2.25}
      />
      <span>Rules enforced by the contract, not by the assistant.</span>
    </p>
  );
}
