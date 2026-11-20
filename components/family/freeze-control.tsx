"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { setFrozen } from "@/lib/api";

export function FreezeControl({ frozen, seniorName }: { frozen: boolean; seniorName: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      await setFrozen(!frozen);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The contract did not answer. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className={
        frozen
          ? "flex flex-wrap items-center justify-between gap-3 rounded-md border border-blocked bg-blocked-soft px-4 py-3"
          : "flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3"
      }
    >
      <div>
        <h2 className="text-sm font-semibold">
          {frozen ? "Payments are paused" : "Payments are on"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {frozen
            ? `Nothing leaves ${seniorName}'s balance until a family member turns payments back on.`
            : "Pause everything right away if something feels wrong."}
        </p>
        {error ? <p className="mt-1 text-sm text-blocked">{error}</p> : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant={frozen ? "default" : "destructive"}
        disabled={pending}
        onClick={() => void run()}
      >
        {pending ? "Asking the contract" : frozen ? "Turn payments back on" : "Pause all payments"}
      </Button>
    </section>
  );
}
