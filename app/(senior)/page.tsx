"use client";

import { useState } from "react";
import { AgentStatus, LastRequest } from "@/components/senior/agent-status";
import { BalanceHero } from "@/components/senior/balance-hero";
import { VoicePanel } from "@/components/senior/voice-panel";
import { useGuardian } from "@/lib/use-guardian";
import type { AgentPhase } from "@/lib/types";

export default function SeniorHomePage() {
  const { account, frozen, payments } = useGuardian();
  const [phase, setPhase] = useState<AgentPhase>("idle");
  const [detail, setDetail] = useState("Tap the button and say who you want to pay.");
  const latest = payments[0] ?? null;

  return (
    <div className="flex flex-1 flex-col gap-8">
      <BalanceHero cents={account.balanceCents} name={account.seniorName} frozen={frozen} />
      <AgentStatus phase={phase} detail={detail} />
      {phase === "idle" ? <LastRequest payment={latest} /> : null}
      <div className="mt-auto pt-4">
        <VoicePanel
          onPhase={(next, text) => {
            setPhase(next);
            setDetail(text);
          }}
        />
      </div>
    </div>
  );
}
