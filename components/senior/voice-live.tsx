"use client";

import { useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { Button } from "@/components/ui/button";
import type { AgentPhase } from "@/lib/types";

export function VoiceLive({
  agentId,
  onPhase,
}: {
  agentId: string;
  onPhase: (phase: AgentPhase, detail: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const conversation = useConversation({
    onConnect: () => {
      onPhase("listening", "Speak in a normal voice. Guardian is listening.");
    },
    onDisconnect: () => {
      onPhase("idle", "Tap the button and say who you want to pay.");
    },
    onError: () => {
      setError("The microphone could not connect. You can try again.");
      onPhase("idle", "Tap the button and say who you want to pay.");
    },
    onMessage: (message) => {
      if (message.source === "ai") {
        onPhase("listening", message.message);
      } else {
        onPhase("checking", `You said: “${message.message}”`);
      }
    },
  });

  const connected = conversation.status === "connected";

  async function start() {
    setError(null);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      await conversation.startSession({ agentId, connectionType: "webrtc" });
    } catch {
      setError("The microphone could not connect. You can try again.");
    }
  }

  async function stop() {
    await conversation.endSession();
  }

  return (
    <div className="space-y-4">
      <Button type="button" size="senior" onClick={connected ? () => void stop() : () => void start()}>
        {connected ? "Stop talking" : "Talk to Guardian"}
      </Button>
      {error ? <p className="text-xl leading-relaxed text-blocked">{error}</p> : null}
      <p className="text-xl leading-relaxed text-ink">
        {connected && conversation.isSpeaking
          ? "Guardian is speaking."
          : "Any payment still has to pass the contract."}
      </p>
    </div>
  );
}
