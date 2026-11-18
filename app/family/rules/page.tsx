"use client";

import { RuleRow } from "@/components/family/rule-row";
import { useGuardian } from "@/lib/use-guardian";

export default function RulesPage() {
  const { rules } = useGuardian();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-serif text-2xl font-medium">Rules</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          These limits live in the contract. Saving a limit does not ask the assistant for permission.
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
