"use client";

import { useGuardian } from "@/lib/use-guardian";
import { cn } from "@/lib/utils";

/** Shown only when the backend can't be reached, so stale numbers are never mistaken for live ones. */
export function ConnectionNotice({ size = "family" }: { size?: "senior" | "family" }) {
  const { connection } = useGuardian();
  if (connection !== "offline") return null;

  return (
    <p
      role="status"
      className={cn(
        "rounded-lg border border-blocked bg-blocked-soft text-ink",
        size === "senior" ? "px-5 py-4 text-xl leading-snug" : "px-3 py-2 text-sm leading-snug",
      )}
    >
      SafeSpend is not connected right now. Nothing here is up to date, and no payments can be made.
    </p>
  );
}
