"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, Hourglass, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addPayee, removePayee } from "@/lib/api";
import type { Payee } from "@/lib/types";
import { useGuardian } from "@/lib/use-guardian";
import { cn } from "@/lib/utils";

function usableFrom(iso: string): string {
  const at = new Date(iso);
  const hours = Math.max(0, (at.getTime() - Date.now()) / 3_600_000);
  const when = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(at);
  const left = hours >= 1 ? `${Math.ceil(hours)} h left` : `${Math.max(1, Math.ceil(hours * 60))} min left`;
  return `Usable from ${when} (${left})`;
}

export default function PayeesPage() {
  const { account, connection, guardians, payees } = useGuardian();
  const senior = account.seniorName || "your family member";
  const actingAs = guardians[0]?.name;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Payees</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          People and businesses {senior} can pay by voice without asking you first, within her limits.
          Anyone else waits for a guardian.
        </p>
      </header>

      <AddPayeeForm senior={senior} actingAs={actingAs} disabled={connection !== "live"} />

      <section className="space-y-2">
        <h2 className="text-sm font-bold">
          On {senior === "your family member" ? "the" : `${senior}'s`} list
          {payees.length > 0 ? <span className="font-normal text-muted-foreground"> ({payees.length})</span> : null}
        </h2>
        {connection === "connecting" ? (
          <p className="text-sm text-muted-foreground">Loading.</p>
        ) : payees.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            No payees yet. Every payment will wait for a guardian.
          </p>
        ) : (
          <ul className="space-y-2">
            {payees.map((p) => (
              <PayeeRow key={p.recipient} payee={p} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AddPayeeForm({ senior, actingAs, disabled }: { senior: string; actingAs?: string; disabled: boolean }) {
  const [name, setName] = useState("");
  const [nicknames, setNicknames] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Payee | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Enter a name.");
      return;
    }
    setSaving(true);
    setError(null);
    setAdded(null);
    try {
      const aliases = nicknames
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5);
      setAdded(await addPayee(name.trim(), aliases));
      setName("");
      setNicknames("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The contract did not add this payee.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4 rounded-lg border border-t-4 border-t-teal bg-card px-4 py-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <UserPlus className="h-4 w-4 text-teal-deep" aria-hidden="true" />
          Add a payee
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          New payees can be paid after a 24-hour wait, so a scammer can&apos;t rush {senior} into paying someone
          they just added. Every guardian is told when someone is added. Payees can only be added here, never by
          voice.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="payee-name">Name</Label>
          <Input
            id="payee-name"
            value={name}
            maxLength={80}
            placeholder="Mike's Plumbing"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="payee-nicknames">What she might call them (optional)</Label>
          <Input
            id="payee-nicknames"
            value={nicknames}
            placeholder="plumber, Mike"
            onChange={(e) => setNicknames(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving || disabled}>
          {saving ? "Asking the contract" : actingAs ? `Add as ${actingAs}` : "Add payee"}
        </Button>
        {error ? <p className="text-sm text-blocked">{error}</p> : null}
        {added ? (
          <p className="text-sm text-teal-deep">
            Added {added.name}. {added.active ? "They can be paid now." : `${usableFrom(added.activeAt)}.`}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function PayeeRow({ payee }: { payee: Payee }) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setRemoving(true);
    setError(null);
    try {
      await removePayee(payee.recipient);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The contract did not remove this payee.");
      setRemoving(false);
      setConfirming(false);
    }
  }

  return (
    <li
      className={cn(
        "grid gap-3 rounded-lg border bg-card px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center",
        payee.active ? "border-border" : "border-held/40",
      )}
    >
      <div className="min-w-0">
        <p className="font-bold text-ink">{payee.name}</p>
        {payee.aliases.length > 0 ? (
          <p className="text-sm text-muted-foreground">Also: {payee.aliases.join(", ")}</p>
        ) : null}
        <p
          className={cn(
            "mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold",
            payee.active ? "bg-safe-soft text-safe" : "bg-held-soft text-held",
          )}
        >
          {payee.active ? (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Hourglass className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {payee.active ? "Can be paid now" : usableFrom(payee.activeAt)}
        </p>
        {error ? <p className="mt-1 text-sm text-blocked">{error}</p> : null}
      </div>
      <div className="flex gap-2">
        {confirming ? (
          <>
            <Button type="button" size="sm" variant="destructive" disabled={removing} onClick={() => void remove()}>
              {removing ? "Removing" : "Remove now"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={removing} onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)}>
            Remove
          </Button>
        )}
      </div>
    </li>
  );
}
