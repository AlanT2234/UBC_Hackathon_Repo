"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { PhoneCall, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { endCall, sendTranscript, startCall, type CallSession } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Demo stand-in for a live phone call. The script is fixed; the scoring is not: every line goes
 * to the backend's call endpoint, and its scam rules decide the risk and whether to pause payments.
 */
const CALLER = "+1 (555) 014-2290";

const SCRIPT: { speaker: "Caller" | "Dorothy"; text: string }[] = [
  { speaker: "Caller", text: "Hello, is this Dorothy? This is Mark from the fraud department at your bank." },
  { speaker: "Dorothy", text: "Oh my. Is something wrong?" },
  { speaker: "Caller", text: "We've seen suspicious charges on your account, so we need to act right away." },
  { speaker: "Caller", text: "To confirm it's really you, read me the last four digits of your credit card number." },
  { speaker: "Dorothy", text: "Okay, let me find my card." },
  { speaker: "Caller", text: "Then I'll text you a one-time code. Read it to me, and we'll move your savings into a safe account." },
  { speaker: "Caller", text: "Please don't tell anyone at the branch. They might be involved." },
];

const LINE_MS = 2600;

/** Words the scorer quoted in its reasons, e.g. `asks for gift cards ("gift cards")`. */
function cues(reasons: string[]): string[] {
  return reasons.flatMap((r) => Array.from(r.matchAll(/"([^"]+)"/g), (m) => m[1]));
}

function highlight(text: string, words: string[]): ReactNode {
  if (words.length === 0) return text;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "gi"));
  return parts.map((part, i) =>
    words.some((w) => w.toLowerCase() === part.toLowerCase()) ? (
      <mark key={i} className="rounded bg-blocked-soft px-0.5 font-semibold text-blocked">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export function ScamCallDemo() {
  const [call, setCall] = useState<CallSession | null>(null);
  const [lines, setLines] = useState<number>(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  async function play() {
    cancelled.current = false;
    setRunning(true);
    setError(null);
    setLines(0);
    let session: CallSession | null = null;
    try {
      session = await startCall(CALLER);
      setCall(session);
      for (let i = 0; i < SCRIPT.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, i === 0 ? 600 : LINE_MS));
        if (cancelled.current) break;
        session = await sendTranscript(session.id, SCRIPT[i].text);
        setCall(session);
        setLines(i + 1);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The call could not be replayed.");
    } finally {
      if (session) await endCall(session.id).catch(() => undefined);
      setRunning(false);
    }
  }

  function stop() {
    cancelled.current = true;
  }

  const risk = Math.round((call?.score.risk ?? 0) * 100);
  const words = cues(call?.score.reasons ?? []);

  return (
    <section className="space-y-3 rounded-md border border-border bg-card px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <PhoneCall className="h-4 w-4" aria-hidden="true" />
            Call listening
          </h2>
          <p className="text-sm text-muted-foreground">
            Calls from unknown numbers are transcribed and checked line by line.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={running ? stop : () => void play()}>
          {running ? "Stop" : "Play demo scam call"}
        </Button>
      </div>

      {call ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">From {call.caller ?? "an unknown number"}</span>
            <span className="font-semibold">Scam risk {risk}%</span>
            {call.frozeVault ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-blocked-soft px-2 py-1 text-xs font-bold text-blocked">
                <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                Payments paused, family alerted
              </span>
            ) : null}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary" aria-hidden="true">
            <div
              className={cn("h-full transition-all duration-700", risk >= 60 ? "bg-blocked" : risk > 0 ? "bg-held" : "bg-safe")}
              style={{ width: `${Math.max(risk, 2)}%` }}
            />
          </div>
          <ol className="space-y-1.5 text-sm" aria-live="polite">
            {SCRIPT.slice(0, lines).map((line, i) => (
              <li key={i} className="leading-relaxed">
                <span className="font-semibold">{line.speaker}: </span>
                {highlight(line.text, words)}
              </li>
            ))}
          </ol>
          {call.score.reasons.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
              {call.score.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="text-sm text-blocked">{error}</p> : null}
    </section>
  );
}
