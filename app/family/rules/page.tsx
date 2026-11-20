"use client";

import { RuleRow } from "@/components/family/rule-row";
import { useGuardian } from "@/lib/use-guardian";

export default function RulesPage() {
  const { rules } = useGuardian();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-display text-2xl font-extrabold">Rules</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          These limits live in the contract. The assistant can&apos;t change them, and neither can anyone on the phone.
        </p>
      </header>
      <ul>
        {rules.map((rule) => (
          <RuleRow key={rule.id} rule={rule} />
        ))}
      </ul>
    </div>
  );
}
