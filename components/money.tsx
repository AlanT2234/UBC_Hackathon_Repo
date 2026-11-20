import { formatDollars } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Money({
  cents,
  className,
}: {
  cents: number;
  className?: string;
}) {
  return (
    // Archivo, not the body font: Atkinson Hyperlegible slashes its zeros, which makes "$500.00" harder to read.
    <span className={cn("font-display tabular-nums", className)}>{formatDollars(cents)}</span>
  );
}
