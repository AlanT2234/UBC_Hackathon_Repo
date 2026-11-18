"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { SAMPLE_REQUESTS, submitVoicePayment } from "@/lib/api";
import type { AgentPhase } from "@/lib/types";

type PhaseHandler = (phase: AgentPhase, detail: string) => void;

type LiveProps = {
  agentId: string;
  onPhase: PhaseHandler;
};

export function VoicePanel({ onPhase }: { onPhase: PhaseHandler }) {
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
  const [busy, setBusy] = useState(false);
  const [Live, setLive] = useState<ComponentType<LiveProps> | null>(null);
  const timers = useRef<number[]>([]);
  const sampleIndex = useRef(0);
  const cancelled = useRef(false);

  useEffect(() => {
    return () => {
      timers.current.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  useEffect(() => {
    if (!agentId) return;
    let mounted = true;
    void import("@/components/senior/voice-live").then((mod) => {
      if (mounted) setLive(() => mod.VoiceLive);
    });
    return () => {
      mounted = false;
    };
  }, [agentId]);

  function later(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const id = window.setTimeout(resolve, ms);
      timers.current.push(id);
    });
  }

  function stopSample() {
    cancelled.current = true;
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    setBusy(false);
    onPhase("idle", "Tap the button and say who you want to pay.");
  }

  async function runSample() {
    const sample = SAMPLE_REQUESTS[sampleIndex.current % SAMPLE_REQUESTS.length];
    sampleIndex.current += 1;
    cancelled.current = false;
    setBusy(true);
    onPhase("listening", `You said: “${sample.said}”`);
    await later(1600);
    if (cancelled.current) return;
    onPhase("checking", "The contract is deciding. The assistant cannot change the answer.");
    await later(1400);
    if (cancelled.current) return;
    const payment = await submitVoicePayment(sample);
    onPhase(payment.status, payment.reason);
    setBusy(false);
  }

  if (agentId) {
    if (!Live) {
      return (
        <Button type="button" size="senior" disabled>
          Opening the microphone
        </Button>
      );
    }
    return <Live agentId={agentId} onPhase={onPhase} />;
  }

  return (
    <div className="space-y-4">
      <Button type="button" size="senior" onClick={busy ? stopSample : () => void runSample()}>
        {busy ? "Stop" : "Talk to Guardian"}
      </Button>
      <p className="text-xl leading-relaxed text-ink">
        Sample requests stand in for the microphone. Each one is still decided by the contract.
      </p>
    </div>
  );
}
