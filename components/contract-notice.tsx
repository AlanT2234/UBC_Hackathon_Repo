import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function ContractNotice({
  size = "family",
  tone = "light",
  className,
}: {
  size?: "senior" | "family";
  tone?: "light" | "dark";
  className?: string;
}) {
  const senior = size === "senior";
  const dark = tone === "dark";
  return (
    <p
      className={cn(
        "flex items-start gap-3 rounded-lg border",
        dark ? "border-navy bg-navy/50 text-cream" : "border-border bg-card text-ink",
        senior ? "px-5 py-4 text-xl leading-snug" : "px-3 py-2 text-sm leading-snug",
        className,
      )}
    >
      <ShieldCheck
        className={cn(senior ? "mt-1 h-7 w-7 shrink-0" : "mt-0.5 h-4 w-4 shrink-0", dark ? "text-teal" : "text-teal-deep")}
        aria-hidden="true"
        strokeWidth={2.25}
      />
      <span>Rules enforced by the contract, not by the assistant.</span>
    </p>
  );
}
