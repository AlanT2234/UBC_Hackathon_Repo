"use client";

import { useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveRule } from "@/lib/api";
import type { Rule } from "@/lib/types";

export function RuleRow({ rule }: { rule: Rule }) {
  const [editing, setEditing] = useState(false);
  const [dollars, setDollars] = useState(
    rule.limitCents === null ? "" : String(rule.limitCents / 100),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function onSave() {
    const amount = Number(dollars);
    if (!Number.isFinite(amount) || amount < 0 || dollars.trim() === "") {
      setError("Enter a dollar amount.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveRule(rule.id, Math.round(amount * 100));
      setEditing(false);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The contract did not save this.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="grid gap-3 border-b border-border py-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{rule.title}</h2>
          {rule.locked && rule.enforcedBy === "contract" ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Set by the contract
            </span>
          ) : null}
          {rule.enforcedBy === "safensound" ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Checked by SafeNSound
            </span>
          ) : null}
        </div>
        <p className="mt-1 font-display text-base font-bold text-ink">{rule.summary}</p>
        <p className="mt-1 text-sm text-muted-foreground">{rule.detail}</p>
        {saved ? (
          <p className="mt-2 text-sm text-safe">Saved. The contract enforces this limit now.</p>
        ) : null}
        {error ? <p className="mt-2 text-sm text-blocked">{error}</p> : null}
        {editing ? (
          <div className="mt-3 flex max-w-xs flex-col gap-2">
            <Label htmlFor={`rule-${rule.id}`}>Amount in dollars</Label>
            <Input
              id={`rule-${rule.id}`}
              inputMode="decimal"
              value={dollars}
              onChange={(event) => setDollars(event.target.value)}
            />
          </div>
        ) : null}
      </div>
      {rule.locked ? null : (
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button type="button" size="sm" disabled={saving} onClick={() => void onSave()}>
                {saving ? "Saving" : "Save to the contract"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              Change limit
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
